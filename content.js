let isInitialized = false;

function initializeContentScript() {
  if (isInitialized) return;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarizeHeadlines') {
      summarizeHeadlines();
      sendResponse({status: 'Processing started'});
    }
    return true;
  });

  isInitialized = true;
}

async function summarizeHeadlines() {
  let apiKey;
  try {
    apiKey = await getApiKey();
    if (!apiKey) {
      await promptForApiKey('Please enter your API key');
      return;
    }
  } catch (error) {
    console.error('Error checking API key:', error);
    showNotification('Error checking API key. Please try again.');
  }
  let counter = 0;
  const limit = 20;

  // This function will be injected into the page
  let headlines = Array.from(document.querySelectorAll('a, h1, h2, h3, h4, h5, h6'));

  // Filter out headlines with images
  headlines = headlines.filter(headline => !headline.querySelector('img'));

  // Filter out subject headlines
  headlines = headlines.filter(headline => headline.textContent.split(' ').length > 2);

  headlines = headlines.slice(0,40);

  // Sort headlines by font size in descending order

  headlines.sort((a, b) => {
    const fontSizeA = parseFloat(window.getComputedStyle(a).fontSize);
    const fontSizeB = parseFloat(window.getComputedStyle(b).fontSize);
    return fontSizeB - fontSizeA;
  });


  // Process only the top 20 headlines
  let promises = [];
  for (let i = 0; i < Math.min(limit, headlines.length); i++) {
    const headline = headlines[i];
    const articleUrl = headline.href || headline.closest('a')?.href;
    if (articleUrl) {
      promises.push(
        fetchSummary(articleUrl, apiKey).then(summary => {
          headline.textContent = summary;
          counter++;
        })
      );
    }
  }

  await Promise.all(promises);
}

// async function fetchSummary(url) {
  // This is a placeholder function. You'll need to implement the actual API call.
  // const response = await fetch('YOUR_LANGUAGE_MODEL_API', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({ url: url }),
  // });
  // const data = await response.json();
  // const response = await fetch(url);
  // const text = await response.text();
  // const parser = new DOMParser();
  // const doc = parser.parseFromString(text, 'text/html');
  // const content = doc.body.innerText;
  // return content.split('\n').slice(0, 5).join(' '); // Return the first 5 lines as a summary
  //return "Headline!";
//}
async function fetchSummary(url, apiKey) {
  let summary = "";
  try {
    const content = await fetchContent(url);
    summary = await summarizeContnet(content, apiKey);//.split(' ').slice(0, 50).join(' '));
  } catch (error) {
    throw new Error('Error fetching summary5 ' + error);
  }
  return summary;
  // return new Promise((resolve, reject) => {
  //   fetchContent(url)
  //     .then(content => summarizeContnet(content))
  //     .then(summary => resolve(summary))
  //     .catch(error => {
  //       console.error('Error fetching or summarizing content:', error);
  //       reject('Error fetching summary5');
  //     });
  // });
}

// Send a message to the background script to fetch a summary
async function fetchContent(url) {
  const response = await chrome.runtime.sendMessage({ action: 'fetchSummary', url: url });
  if (!response || !response.html) {
    throw new Error('Error fetching summary6');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(response.html, 'text/html');
  const paragraphs = Array.from(doc.querySelectorAll('p'));
  let content = paragraphs.map(p => p.textContent).join(' ').trim();
  return content;
  // return new Promise((resolve, reject) => {
  //   chrome.runtime.sendMessage({ action: 'fetchSummary', url: url }, response => {
  //     if (response && response.html) {
  //       const parser = new DOMParser();
  //       const doc = parser.parseFromString(response.html, 'text/html');
        
  //       // Extract text content from <p> tags
  //       const paragraphs = Array.from(doc.querySelectorAll('p'));
  //       let content = paragraphs.map(p => p.textContent).join(' ').trim();
        
  //       // Return the first 5 lines as a summary
  //       content = content.split('\n').slice(0, 5).join(' ');
  //       resolve(content)
  //       } else {
  //       reject('Error fetching summary6');
  //     }
  //   });
  // });
}

async function summarizeContnet(content, apiKey) {
  const prompt = "please summarize this article to an informative (not clickbate) and short headline, in the article language: " + content;
  const response = await chrome.runtime.sendMessage({ action: 'AIcall', prompt: prompt, apiKey: apiKey });
  if (!response ||  !response.summary) {
    throw new Error('Error fetching summary7');
  }
  return response.summary;
  // return new Promise((resolve, reject) => {
  //   chrome.runtime.sendMessage({ action: 'AIcall', prompt: prompt }, response => {
  //     if (response && response.summary) {
  //       resolve(response.summary);
  //     }else {
  //       reject('Error fetching summary7');
  //     }
  //   })});
}

async function getApiKey() {
  const result = await chrome.storage.sync.get(['apiKey']);
  return result.apiKey;
}

function createApiKeyPrompt(message, currentKey = '') {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  const promptBox = document.createElement('div');
  promptBox.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    width: 300px;
  `;

  const title = document.createElement('h3');
  title.textContent = message;
  title.style.marginBottom = '15px';

  const linkToGenerateKey = document.createElement('a');
  linkToGenerateKey.textContent = 'Generate an API key';
  linkToGenerateKey.href = 'https://console.groq.com/keys';
  linkToGenerateKey.target = '_blank';
  linkToGenerateKey.style.cssText = `
    display: block;
    margin-bottom: 15px;
    color: #4285F4;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentKey;
  input.placeholder = 'Enter your API key';
  input.style.cssText = `
    width: 100%;
    padding: 8px;
    margin-bottom: 15px;
    border: 1px solid #ccc;
    border-radius: 4px;
  `;

  const submitButton = document.createElement('button');
  submitButton.textContent = 'Save';
  submitButton.style.cssText = `
    background: #4285F4;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    margin-right: 10px;
  `;

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.cssText = `
    background: #gray;
    border: 1px solid #ccc;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  `;

  promptBox.appendChild(linkToGenerateKey);
  promptBox.appendChild(title);
  promptBox.appendChild(input);
  promptBox.appendChild(submitButton);
  promptBox.appendChild(cancelButton);
  overlay.appendChild(promptBox);

  return { overlay, input, submitButton, cancelButton };
}

async function promptForApiKey(message, currentKey = '') {
  return new Promise((resolve, reject) => {
    const { overlay, input, submitButton, cancelButton } = createApiKeyPrompt(message, currentKey);
    document.body.appendChild(overlay);

    submitButton.onclick = async () => {
      const apiKey = input.value.trim();
      if (apiKey) {
        await chrome.storage.sync.set({ apiKey });
        document.body.removeChild(overlay);
        summarizeHeadlines();
        resolve(apiKey);
      } else {
        input.style.border = '1px solid red';
      }
    };

    cancelButton.onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };
  });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarizeHeadlines') {
    summarizeHeadlines();
  }
});


initializeContentScript();