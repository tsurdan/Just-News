chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'summarizeHeadlines' });
});

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchSummary') {
    fetch(request.url)
      .then(response => response.text())
      .then(text => {
        sendResponse({ html: text });
      })
      .catch(error => {
        console.error('Error fetching summary1:', error);
        sendResponse({ html: `Error fetching summary2 ${error}` });
      });
    return true; // Will respond asynchronously
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'AIcall') {

    const apiKey = "";
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
      console.error('Error fetching summary3:', error);
      sendResponse({ summary: `Error fetching summary4 ${error}` });
    });
    return true;// Will respond asynchronously
    //sendResponse("headlineheadline");

  }
});

