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
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'AIcall') {
    console.log(request.prompt);
    const apiKey = request.apiKey;//"";
    const systemPrompt = "You are a punctual and tough journalist. Give informative and short headlines as much as possible";
    const baseURL = "https://api.groq.com/openai/v1/chat/completions";

    const prompt = request.prompt;
    const body = JSON.stringify({
      model: "llama-3.1-70b-versatile", //claude-3-opus-20240229 gpt-4o-2024-05-13
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
      const summary = JSON.stringify(data.choices[0].message.content);
      //const summary = JSON.stringify(data);
      sendResponse({ summary: summary });
    })
    // .then(data => {
    //   const response1 = JSON.stringify(data.choices[0].message.content);

    //   console.log("User:", prompt);
    //   console.log("AI:", response1);

    //   sendResponse({ summary: response1 });
    //   return true; // Will respond asynchronously
    // })
    .catch(error => {
      // TODO: remove
      sendResponse({ summary: "~ סיכום קצר ואינפורמטיבי" });
      //sendResponse({ error: error.message });
    });
    return true;// Will respond asynchronously
    //sendResponse("headlineheadline");

  }
});

