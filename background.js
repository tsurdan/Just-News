// limit for non-premium users
const DAILY_LIMIT = 30;

if (typeof browser !== 'undefined' && !chrome) {
  // Firefox uses 'browser' namespace
  window.chrome = browser;
}
const actionAPI = typeof chrome.action !== 'undefined' ? chrome.action : chrome.browserAction;


actionAPI.onClicked.addListener((tab) => {
  // Show loading badge
  actionAPI.setBadgeText({ tabId: tab.id, text: '...' });
  try {
    actionAPI.setBadgeBackgroundColor({ tabId: tab.id, color: '#4285F4' });
  } catch (e) {
    // not working in android firefox
  }
  chrome.tabs.sendMessage(tab.id, { action: 'summarizeHeadlines' });
});
const dl = 5 * 6;

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchContent') {
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
    const apiKey = request.apiKey;
    const model = request.model;
    const apiProvider = request.apiProvider || "groq";
    const systemPrompt = request.systemPrompt && request.systemPrompt.trim().length > 0
      ? request.systemPrompt
      : `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;

    // Set baseURL based on provider
    let baseURL;
    if (apiProvider === "groq") {
      baseURL = "https://api.groq.com/openai/v1/chat/completions";
    } else if (apiProvider === "openai") {
      baseURL = "https://api.openai.com/v1/chat/completions";
    } else if (apiProvider === "claude") {
      baseURL = "https://api.anthropic.com/v1/messages";
    } else if (apiProvider === "gemini") {
      // Gemini API key is in the URL as ?key=API_KEY
      baseURL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    } else {
      baseURL = "https://api.groq.com/openai/v1/chat/completions";
    }

    let prompt = request.prompt;
    console.log(prompt);

    let body, headers;
    if (apiProvider === "claude") {
      body = JSON.stringify({
        model: model,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }]
      });
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      };
    } else if (apiProvider === "gemini") {
      body = JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: prompt }] }
        ]
      });
      headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
        // No Authorization header for Gemini, key is in URL
      };
    } else {
      // OpenAI, Groq (OpenAI compatible)
      body = JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.0,
        max_tokens: 300,
        top_p: 0.4,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
      });
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      };
    }

    fetch(baseURL, {
      method: "POST",
      headers: headers,
      body: body,
    })
      .then(response => {
        if (!response.ok) {
          if (response.status === 429) {
            throw new Error(`Rate limit. Try again in ${(response.headers.get('retry-after') || 'a few') + ' seconds'}`);
          }
          if (response.status === 401) {
            throw new Error('Invalid API key');
          }
          throw new Error('Error fetching summary');
        } else {
          return response.json();
        }
      })
      .then(data => {
        let summary;
        if (apiProvider === "claude") {
          summary = data.content?.[0]?.text || data.completion || "";
        } else if (apiProvider === "gemini") {
          summary = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
          summary = data.choices?.[0]?.message?.content || "";
        }
        // Don't clean the JSON - let content script parse it
        sendResponse({ summary: summary });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true; // Will respond asynchronously
  } else if (request.action === 'checkPremium') {
    // Check premium status from storage
    chrome.storage.sync.get(['premium'], (result) => {
      sendResponse({ ipb: !!result.premium });
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'headlineChanged') {
    // Remove loading badge when first headline changes
    actionAPI.setBadgeText({ tabId: sender.tab.id, text: '' });
    sendResponse({ status: 'badge cleared' });
    return;
  } else if (request.action === 'checkDailyLimit') {
    const today = new Date().toDateString();
    chrome.storage.local.get(['dailyUsage'], (result) => {
      try {
        const dailyUsage = result.dailyUsage || {};

        // Clean up old dates
        Object.keys(dailyUsage).forEach(date => {
          if (date !== today) delete dailyUsage[date];
        });

        const todayCount = dailyUsage[today] || 0;
        sendResponse({
          canProceed: todayCount < dl,
          count: todayCount,
          reason: todayCount >= dl ? 'dailyLimit' : null
        });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    });
    return true;
  }

  if (request.action === 'incrementDailyCount') {
    const today = new Date().toDateString();
    chrome.storage.local.get(['dailyUsage'], (result) => {
      try {
        const dailyUsage = result.dailyUsage || {};
        dailyUsage[today] = (dailyUsage[today] || 0) + 1;

        chrome.storage.local.set({ dailyUsage }, () => {
          sendResponse({
            limitReached: dailyUsage[today] >= dl,
            count: dailyUsage[today]
          });
        });
      } catch (error) {
        sendResponse({ error: error.message });
      }
    });
    return true;
  }
});

const REQUIRED_TOKEN = 'e23de-32dd3-d2fg3fw-f34f3w';

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "activatePremium" && message.token == REQUIRED_TOKEN) {
        chrome.storage.sync.set({ premium: true }, () => {
          console.log('Premium unlocked via success page!');
        });

        setTimeout(() => {
          chrome.runtime.openOptionsPage(() => {
            console.log('Options page opened after premium unlock');
          });
        }, 10000);
    return true;
  }
});

