chrome.action.onClicked.addListener((tab) => {
  // Show loading badge
  chrome.action.setBadgeText({ tabId: tab.id, text: '...' });
  chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#4285F4' });
  chrome.tabs.sendMessage(tab.id, { action: 'summarizeHeadlines' });
});

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
    const systemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;
    const baseURL = "https://api.groq.com/openai/v1/chat/completions";

    let prompt = request.prompt;
    console.log(prompt);
    const body = JSON.stringify({
      model: model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.0,
      max_tokens: 50,
      top_p: 0.4,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
    });

    fetch(baseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
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
      }})
    .then(data => {
      let summary = data.choices[0].message.content;
      summary = summary.replace(/[\r\n]+/g, ' ').trim(); // Remove newlines and trim
      summary = summary.replace(/\\n/g, ' '); // Remove escaped newlines
      summary = summary.replace(/##/g, ''); // Remove markdown headers
      summary = summary.replace(/["]+/g, ''); // Remove unnecessary quotes
      sendResponse({ summary: summary });
    })
    .catch(error => {
      sendResponse({ error: error.message });
    });
    return true; // Will respond asynchronously
  } else if (request.action === 'headlineChanged') {
    // Remove loading badge when first headline changes
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: '' });
    sendResponse({ status: 'badge cleared' });
    return;
  }
});

