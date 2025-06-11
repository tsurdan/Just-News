let isInitialized = false;
let counter = 0;

function initializeContentScript() {
  if (isInitialized) return;

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarizeHeadlines') {
      counter = 0;
      summarizeHeadlines();
      sendResponse({status: 'Processing started'});
    }
    return true;
  });

  isInitialized = true;
}

async function summarizeHeadlines() {
  let apiKey = "";
  let apiProvider = "groq";
  let model = "gemma2-9b-it";
  let customPrompt = "";
  let systemPrompt = "";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

Robotic, factual, no clickbait.
Summarizing the key point of the article.
Keep the original language (if it hebrew give new hebrew title) and length.`;

  try {
    const settings = await chrome.storage.sync.get(['apiKey', 'apiProvider', 'model', 'customPrompt', 'systemPrompt']);
    apiKey = settings.apiKey || "";
    apiProvider = settings.apiProvider || "groq";
    model = settings.model || "gemma2-9b-it";
    customPrompt = settings.customPrompt || defaultPrompt;
    systemPrompt = settings.systemPrompt || defaultSystemPrompt;
    if (!apiKey) {
      await promptForApiKey('Enter API key (one-time setup)');
      return;
    }
  } catch (error) {
    await createNotification('Error checking API key. Please try again.');
  }
  const apiOptions = {"apiKey": apiKey, "apiProvider": apiProvider, "model": model, "customPrompt": customPrompt, "systemPrompt": systemPrompt}; 
  const limit = 20;
  let firstHeadlineChanged = false;

  // This function will be injected into the page
  let headlines = Array.from(document.querySelectorAll('a, a span, h1, h2, h3, h4, h5, h6, span[class*="title"], span[class*="title"], strong[data-type*="title"], span[class*="headline"], strong[data-type*="headline"], span[data-type*="title"], strong[class*="title"], span[data-type*="headline"], strong[class*="headline"], span[class*="Title"], strong[data-type*="Title"], span[class*="Headline"], strong[data-type*="Headline"], span[data-type*="Title"], strong[class*="Title"], span[data-type*="Headline"], strong[class*="Headline"]'));
  
  // Filter out headlines with images
  headlines = headlines.filter(headline => !headline.querySelector('img'));

  //filter out processed headlines
  headlines = headlines.filter(headline => !headline.textContent.includes('~'));

  // Filter out headlines that are not in the user's screen frame
  const viewportHeight = window.innerHeight;
  const viewportTop = window.scrollY // Maybe Add extra space to the frame?
  const viewportBottom = viewportTop + viewportHeight

  headlines = headlines.filter(headline => {
    const rect = headline.getBoundingClientRect();
    const headlineTop = rect.top + window.scrollY;
    const headlineBottom = rect.bottom + window.scrollY;
    return (headlineTop >= viewportTop && headlineBottom <= viewportBottom);
  });

  // Filter out subject headlines
  headlines = headlines.filter(headline => headline.textContent.split(' ').length > 3);

  // Sort headlines by font size in descending order
  headlines.sort((a, b) => {
    const fontSizeA = parseFloat(window.getComputedStyle(a).fontSize);
    const fontSizeB = parseFloat(window.getComputedStyle(b).fontSize);
    return fontSizeB - fontSizeA;
  });

  // Process only the top <limit> headlines
  let rateLimitHit = false;
  let promises = [];
  for (let i = counter; i < Math.min(limit + counter, headlines.length); i++) {
    if (rateLimitHit) break;
    const headline = headlines[i];
    const sourceHeadline = headline.textContent;
    const articleUrl = headline.href || headline.closest('a')?.href;
    if (articleUrl) {
      promises.push(
        fetchSummary(sourceHeadline, articleUrl, apiOptions)
          .then(summary => {
            const sanitizedSummary = summary.replace(/[\r\n]+/g, ' ').trim();
            typeHeadline(headline, `~${sanitizedSummary}`);
            counter++;
            // Notify background to clear badge after first headline changes
            if (!firstHeadlineChanged) {
              firstHeadlineChanged = true;
              chrome.runtime.sendMessage({ action: 'headlineChanged' });
            }
          })
          .catch(error => {
            if (error.message && error.message.includes('Rate limit')) {
              rateLimitHit = true;
            }
            throw new Error(error.message);
          })
      );
    }
  }

  const results = await Promise.allSettled(promises);
  const succes = results.filter(result => result.status === 'fulfilled');  
  const errors = results.filter(result => result.status === 'rejected');
  if (succes.length === 0 && errors.length > 0) {
    let minRetryAfter = null;
    let hasRateLimit = false;
    errors.forEach(e => {
      let msg = e.reason.message || '';
      if (msg.includes('Rate limit')) {
        hasRateLimit = true;
        const match = msg.match(/Try again in (\d+)/);
        if (match) {
          const retry = parseInt(match[1], 10);
          if (minRetryAfter === null || retry < minRetryAfter) minRetryAfter = retry;
        }
      }
    });
    if (hasRateLimit) {
      let summary = minRetryAfter !== null
        ? `Rate limit. Try again in ${minRetryAfter} seconds`
        : 'Rate limit. Try again later';
      await createNotification(summary);
    } else {
      let errorTypes = new Set();
      errors.forEach(e => {
        let msg = e.reason.message || '';
        if (msg.includes('Error extracting article content')) {
          errorTypes.add('Error extracting article content');
        } else if (msg.includes('Invalid API key')) {
          errorTypes.add('Invalid API key');
        } else {
          errorTypes.add(msg.split(',')[0]);
        }
      });
      let summary = Array.from(errorTypes).join(', ');
      await createNotification(summary);
    }
  }
}

// Function to type the headline letter by letter
function typeHeadline(element, text) {
  let index = 0;
  element.textContent = '';
  const interval = setInterval(() => {
    if (index < text.length) {
      element.textContent += text[index];
      index++;
    } else {
      clearInterval(interval);
    }
  }, 50); // Adjust typing speed by changing the interval time
}

async function fetchSummary(sourceHeadline, url, options) {
  let summary = "";
  try {
    const content = await fetchContent(url);
    // Ensure model, customPrompt, systemPrompt, apiProvider are in scope
    summary = await summarizeContnet(
      sourceHeadline,
      content,
      options
    );
  } catch (error) {
    throw new Error(error.message);
  }
  return summary;
}

// Send a message to the background script to fetch a summary
async function fetchContent(url) {
  const response = await chrome.runtime.sendMessage({ action: 'fetchContent', url: url });
  if (!response || response?.error || !response.html) {
    throw new Error('Error fetching article content' + response?.error);
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(response.html, 'text/html');
  
  // Remove script and style tags
  doc.querySelectorAll('script, style').forEach(tag => tag.remove());

  // Remove common non-article sections
  const nonArticleSelectors = [
    'header', 'footer', 'nav', 'aside', '.sidebar', '.nav', '.footer', '.header', '.advertisement', '.ad', '.promo'
  ];
  nonArticleSelectors.forEach(selector => {
    doc.querySelectorAll(selector).forEach(tag => tag.remove());
  });

  // Extract text content from <p> tags
  const paragraphs = Array.from(doc.querySelectorAll('p'));
  let content = paragraphs.map(p => p.textContent).join(' ').trim();
  
  if (!content || content.length === 0) {
    const otherTags = Array.from(doc.querySelectorAll('span'));
    const uniqueSentences = new Set();
    otherTags.forEach(tag => {
      const sentences = tag.textContent.split('.').map(sentence => sentence.trim()).filter(sentence => sentence.length > 0);
      sentences.forEach(sentence => uniqueSentences.add(sentence));
    });
    content = Array.from(uniqueSentences).join('. ');
  }

  if (!content || content.length === 0) {
    const otherTags = Array.from(doc.querySelectorAll('article'));
    const uniqueSentences = new Set();
    otherTags.forEach(tag => {
      const sentences = tag.textContent.split('.').map(sentence => sentence.trim()).filter(sentence => sentence.length > 0);
      sentences.forEach(sentence => uniqueSentences.add(sentence));
    });
    content = Array.from(uniqueSentences).join('. ');
  }

  if (!content || content.length === 0) {
    throw new Error('Error extracting article content');
  }
  
  return content;
}

async function summarizeContnet(sourceHeadline, content, options) {
  const { apiKey, apiProvider, model, customPrompt, systemPrompt } = options;
  const defaultEndOfPrompt = 
  `Original: ${sourceHeadline}
   Article: ${content}

   Return only the new headline.`;
  const prompt = customPrompt + defaultEndOfPrompt;
  const response = await chrome.runtime.sendMessage({
    action: 'AIcall',
    sourceHeadline,
    prompt,
    apiKey,
    model,
    systemPrompt,
    apiProvider // <-- pass provider
  });
  if (!response || response?.error || !response.summary) {
    throw new Error('Error fetching AI summary ' + response?.error);
  }
  return response.summary;
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
    font-family: Roboto, sans-serif;
  `;

  const promptBox = document.createElement('div');
  promptBox.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    width: 300px;
    box-sizing: border-box;
  `;

  const title = document.createElement('h3');
  title.textContent = message;
  title.style.cssText = `
    text-align: left;
    font-size: 16px;
    color: black;
    font-weight: bold;
    margin-bottom: 15px;
  `;

  const linkToGenerateKey = document.createElement('a');
  linkToGenerateKey.textContent = 'Generate key here';
  linkToGenerateKey.href = 'https://console.groq.com/keys';
  linkToGenerateKey.target = '_blank';
  linkToGenerateKey.style.cssText = `
    margin-bottom: 15px;
    color: #4285F4;
    text-decoration: underline;
    text-align: left;
    font-size: 12px;
    display: block;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentKey;
  input.placeholder = 'Enter your key';
  input.style.cssText = `
    width: 100%;
    padding: 8px;
    margin-bottom: 15px;
    border: 1px solid #ccc;
    border-radius: 4px;
    box-sizing: border-box;
    text-align: left;
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
    background: gray;
    border: 1px solid #ccc;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
  `;

  promptBox.appendChild(title);
  promptBox.appendChild(linkToGenerateKey);
  promptBox.appendChild(input);
  promptBox.appendChild(submitButton);
  promptBox.appendChild(cancelButton);
  overlay.appendChild(promptBox);

  return { overlay, input, submitButton, cancelButton };
}

function createNotificationPrompt(message) {
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
    font-family: Roboto, sans-serif;
  `;

  const promptBox = document.createElement('div');
  promptBox.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    width: 300px;
    box-sizing: border-box;
  `;

  const title = document.createElement('h3');
  title.textContent = message;
  title.style.cssText = `
    text-align: center;
    color: black;
    margin-bottom: 15px;
  `;

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'OK';
  cancelButton.style.cssText = `
    background: gray;
    border: 1px solid #ccc;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    align-self: center;
    display: block;
    margin: 0 auto;
  `;

  promptBox.appendChild(title);
  promptBox.appendChild(cancelButton);
  overlay.appendChild(promptBox);

  return { overlay, cancelButton };
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

async function createNotification(message) {
  return new Promise((resolve, reject) => {
    const { overlay, cancelButton } = createNotificationPrompt(message);
    document.body.appendChild(overlay);

    cancelButton.onclick = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };
  });
}


initializeContentScript();