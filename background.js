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
    console.log(request.prompt)
    const apiKey = request.apiKey;
    const systemPrompt = "You are a punctual and tough journalist. Give informative and short headlines as much as possible";
    const baseURL = "https://api.groq.com/openai/v1/chat/completions";

    let prompt = request.prompt;


    // Calculate the number of tokens in the request
    let tokenCount = calculateTokens(systemPrompt + prompt);
    const maxAllowedTokens = 10000;

    if (tokenCount > maxAllowedTokens) {
      const words = prompt.split(/\s+/);
      prompt = words.slice(0, maxAllowedTokens).join(' ');
      tokenCount = calculateTokens(systemPrompt + truncatedPrompt);
    }

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
      temperature: 0.2,
      max_tokens: 50,
    });

    fetch(baseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: body,
    })
    .then(response => response.json())
    .then(data => {
      let summary = data.choices[0].message.content;
      summary = summary.replace(/[\r\n]+/g, ' ').trim(); // Remove newlines and trim
      summary = summary.replace(/\\n/g, ' '); // Remove escaped newlines
      summary = summary.replace(/##/g, ''); // Remove markdown headers
      summary = summary.replace(/["]+/g, ''); // Remove unnecessary quotes
      sendResponse({ summary: summary });
    })
    .catch(error => {
      console.error("error: ", error.message);
      sendResponse({ error: error.message });
    });
    return true; // Will respond asynchronously
  }
});

// Function to calculate the number of tokens in a text
function calculateTokens(text) {
  // This is a simple approximation. You may need a more accurate method depending on your use case.
  return text.split(/\s+/).length;
}

