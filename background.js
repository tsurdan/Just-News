// oauth_extension.js
async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(buffer));
  return new Uint8Array(digest);
}
function base64url(bytes) {
  let s = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePKCEPair() {
  // generate a random code_verifier (43..128 chars recommended)
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  const code_verifier = Array.from(arr).map(b => ("0" + b.toString(16)).slice(-2)).join('');
  const hashed = await sha256(code_verifier);
  const code_challenge = base64url(hashed);
  return { code_verifier, code_challenge };
}

async function loginWithGoogleAndExchange(workerUrl, clientId) {
  const redirectUri = chrome.identity.getRedirectURL();
  console.log('Redirect URI:', redirectUri); // Log to see what to register in Google Console
  const { code_verifier, code_challenge } = await generatePKCEPair();
  await chrome.storage.local.set({ code_verifier }); // store verifier locally briefly

  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email",
    code_challenge: code_challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    access_type: "offline"
  }).toString();

  // launch OAuth popup
  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redir) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(redir);
      }
    });
  });

  // parse code from redirectUrl
  const u = new URL(redirectUrl);
  const code = u.searchParams.get('code');
  if (!code) throw new Error('No code returned');

  // fetch verifier and send to worker to exchange
  const { code_verifier: verifier } = await chrome.storage.local.get(['code_verifier']);
  await chrome.storage.local.remove('code_verifier');

  const resp = await fetch(`${workerUrl}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri
    })
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('Exchange failed: ' + t);
  }

  const json = await resp.json();
  // json = { jwt: "...", user: { sub, email, name } }
  await chrome.storage.local.set({ access_jwt: json.jwt, user: json.user });
  return json.user;
}

// Global refresh lock to prevent concurrent refresh attempts
let refreshPromise = null;

// Helper function to refresh token (with lock)
async function refreshToken(workerUrl, access_jwt) {
  // If a refresh is already in progress, wait for it
  if (refreshPromise) {
    console.log('Refresh already in progress, waiting...');
    return refreshPromise;
  }

  // Start new refresh
  refreshPromise = (async () => {
    try {
      const refreshed = await fetch(`${workerUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (access_jwt || '') },
        body: '{}' // body not used
      });
      if (!refreshed.ok) {
        // Refresh failed - clear auth and prompt user to login again
        await chrome.storage.local.remove(['access_jwt', 'user']);
        throw new Error('Session expired. Please sign in again.');
      }
      const rj = await refreshed.json();
      await chrome.storage.local.set({ access_jwt: rj.jwt });
      console.log('Token refreshed successfully');
      return rj.jwt;
    } catch (error) {
      // Clear auth on any error
      await chrome.storage.local.remove(['access_jwt', 'user']);
      throw new Error(`Error refreshing token: ${error.message}`);
    } finally {
      // Clear the lock after 2 seconds to allow future refreshes if needed
      setTimeout(() => { refreshPromise = null; }, 2000);
    }
  })();

  return refreshPromise;
}

// helper to call proxy with JWT
async function callProxy(workerUrl, groqPayload) {
  const { access_jwt } = await chrome.storage.local.get('access_jwt');
  const res = await fetch(`${workerUrl}/proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (access_jwt || ''),
      'X-JustNews-Key': "363bce11-3b8e-4e36-ae08-11d332dc8e23"
    },
    body: JSON.stringify(groqPayload)
  });
  if (!res.ok) {
    const msg = await res.text();
    if (res.status === 401) {
      // token expired or invalid; call refresh with lock
      try {
        await refreshToken(workerUrl, access_jwt);
      } catch (error) {
        // If refresh failed, throw error with message to prompt login
        throw new Error(`Authentication failed. Please sign in again.`);
      }

      // retry original call with new token
      try {
        const { access_jwt: newToken } = await chrome.storage.local.get('access_jwt');
        const retryRes = await fetch(`${workerUrl}/proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (newToken || ''),
            'X-JustNews-Key': "363bce11-3b8e-4e36-ae08-11d332dc8e23"
          },
          body: JSON.stringify(groqPayload)
        });
        if (!retryRes.ok) {
          if (retryRes.status === 429) {
            console.log(`Rate limited on retry.`);
            throw new Error(msg);
          } else {
            throw new Error('Error fetching summary');
          }
        }
        return retryRes.json();
      } catch (error) {
        throw new Error(`Error after token refresh: ${error.message}`);
      }
    } else if (res.status === 429) {
      console.log(`Rate limited.`);
      throw new Error(msg);
    } else {
      throw new Error('Error fetching summary');
    }
  } else {
    return res.json();
  }
}

// Configuration
const WORKER_URL = 'https://just-news-proxy.tzurda3.workers.dev';
const CLIENT_ID = '621443676546-jn672ssj85ce7hi7ffih6lfq0e77elu4.apps.googleusercontent.com'; // Replace with the new Web Application client ID

// Add context menu for toggling auto headline replacement
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'toggleAutoReplace',
    title: 'Turn Off/On Auto Headline Replacement',
    contexts: ['action'] // Only show when right-clicking the extension icon
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'toggleAutoReplace') {
    chrome.storage.sync.get(['autoReplaceHeadlines'], (data) => {
      const current = (typeof data.autoReplaceHeadlines === 'boolean') ? data.autoReplaceHeadlines : true;
      const newValue = !current;
      chrome.storage.sync.set({ autoReplaceHeadlines: newValue }, () => {
        console.log('Auto Headline Replacement set to', newValue);
      });
    });
  }
});

// Helper to check if user is authenticated
async function isAuthenticated() {
  const { access_jwt, user } = await chrome.storage.local.get(['access_jwt', 'user']);
  return !!(access_jwt && user);
}

chrome.action.onClicked.addListener(async (tab) => {
  // Check if user is authenticated
  const authenticated = await isAuthenticated();

  if (!authenticated) {
    // Prompt user to login
    chrome.tabs.sendMessage(tab.id, { action: 'promptLogin' });
    return;
  }

  // Show loading badge
  chrome.action.setBadgeText({ tabId: tab.id, text: '...' });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4285F4' });
  chrome.tabs.sendMessage(tab.id, { action: 'summarizeHeadlines' });
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'login') {
    // Initiate Google OAuth login
    loginWithGoogleAndExchange(WORKER_URL, CLIENT_ID)
      .then(user => {
        sendResponse({ success: true, user });
      })
      .catch(error => {
        console.log('Login failed:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Will respond asynchronously
  } else if (request.action === 'checkAuth') {
    // Check if user is authenticated
    isAuthenticated().then(authenticated => {
      if (authenticated) {
        chrome.storage.local.get(['user'], (result) => {
          sendResponse({ authenticated: true, user: result.user });
        });
      } else {
        sendResponse({ authenticated: false });
      }
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'logout') {
    // Clear authentication
    chrome.storage.local.remove(['access_jwt', 'user'], () => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'fetchContent') {
    fetch(request.url)
      .then(response => response.text())
      .then(html => {
        if (html.includes("Please enable JS and disable any ad blocker")) {
          // Fallback to injecting script if direct fetch fails
          chrome.scripting.executeScript(
            {
              target: { tabId: sender.tab.id },
              func: (url) => {
                return new Promise((resolve, reject) => {
                  const fetchContent = () => {
                    fetch(url)
                      .then(response => response.text())
                      .then(html => {
                        resolve(html);
                      })
                      .catch(error => {
                        reject('Error fetching article content: ' + error.message);
                      });
                  };

                  const checkReadyState = () => {
                    if (document.readyState === 'complete') {
                      fetchContent();
                    } else {
                      setTimeout(checkReadyState, 100);
                    }
                  };
                  checkReadyState();
                });
              },
              args: [request.url],
            },
            (results) => {
              if (results && results[0] && results[0].result) {
                sendResponse({ html: results[0].result });
              } else {
                sendResponse({ error: 'Error fetching article content' });
              }
            }
          );
        } else {
          sendResponse({ html: html });
        }
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true; // Will respond asynchronously
  } else if (request.action === 'AIcall') {
    const systemPrompt = request.systemPrompt;
    const prompt = request.prompt;

    // Use authenticated proxy for Groq calls
    const Payload = {
      systemPrompt: systemPrompt,
      prompt: prompt,
      sourceHeadline: request.sourceHeadline,
      content: request.content,
      preferedLang: request.preferedLang || 'english'
    };
    console.log(JSON.stringify(Payload));

    callProxy(WORKER_URL, Payload)
      .then(data => {
        const summary = data.choices?.[0]?.message?.content || "";
        sendResponse({ summary: summary });
      })
      .catch(error => {
        console.log('AI call error:', error);
        sendResponse({ error: error.message });
      });
    return true; // Will respond asynchronously
  } else if (request.action === 'checkPremiumStatus') {
    // Check if user has premium from JWT
    chrome.storage.local.get(['access_jwt'], (data) => {
      let isPremium = false;
      if (data.access_jwt) {
        try {
          const payload = data.access_jwt.split('.')[1];
          const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
          isPremium = !!decoded.premium;
        } catch (e) {
          isPremium = false;
        }
      }
      sendResponse({ isPremium: isPremium });
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'headlineChanged') {
    // Remove loading badge when first headline changes
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    sendResponse({ status: 'badge cleared' });
    return;
  }
});

