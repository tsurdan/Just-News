chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'summarizeHeadlines' });
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchContent') {
    fetch(request.url)
      .then(response => response.text())
      .then(text => {
        sendResponse({ html: text });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true; // Will respond asynchronously
  } else if (request.action === 'AIcall') {

    const apiKey = request.apiKey;
    const systemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer.`;
    const baseURL = "https://api.groq.com/openai/v1/chat/completions";

    let prompt = request.prompt;

    const body = JSON.stringify({
      model: "gemma2-9b-it",
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
        throw new Error('Rate limit. Try again in a minute');
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
  }
});

