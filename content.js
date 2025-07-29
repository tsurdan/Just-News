let isInitialized = false;
let counter = 0;
let articleSummaries = new Map(); // Cache for article summaries

function initializeContentScript() {
  if (isInitialized) return;
  
  // Add tooltip styles to the page
  addTooltipStyles();

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

// Add CSS styles for tooltips
function addTooltipStyles() {
  if (document.getElementById('just-news-tooltip-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'just-news-tooltip-styles';
  style.textContent = `
    .just-news-tooltip {
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.4;
      max-width: 350px;
      z-index: 10000;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
      word-wrap: break-word;
    }
    .just-news-tooltip.show {
      opacity: 1;
    }
    .just-news-tooltip-loading {
      color: #aaa;
      font-style: italic;
    }
    .just-news-processed-headline {
      cursor: help;
      position: relative;
    }
  `;
  document.head.appendChild(style);
}

async function summarizeHeadlines() {
  let apiKey = "";
  let apiProvider = "groq";
  let model = "gemma2-9b-it";
  let customPrompt = "";
  let systemPrompt = "";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

- Robotic, factual, no clickbait
- Summarize the key point of the article
- Keep the original language (if Hebrew, give new Hebrew title) and similar length
- Be objective and informative`;

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

  //filter out duplicated headlines
  const uniqueHeadlines = new Set();
  headlines = headlines.filter(headline => {
    const text = headline.textContent.trim();
    if (uniqueHeadlines.has(text)) {
      return false;
    }
    uniqueHeadlines.add(text);
    return true;
  });

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
          .then(result => {
            // Parse the JSON response using dedicated function
            const { headline: newHeadline, summary } = parseAIResponse(result);
            
            // Cache the summary for tooltip use
            articleSummaries.set(articleUrl, summary);
            
            typeHeadline(headline, `~${newHeadline}`);
            counter++;
            // Notify background to clear badge after first headline changes
            if (!firstHeadlineChanged) {
              firstHeadlineChanged = true;
              chrome.runtime.sendMessage({ action: 'headlineChanged' });
            }
          })
          .catch(error => {
            // Skip this headline if there's an error (including JSON parsing issues)
            if (error.message && error.message.includes('Rate limit')) {
              rateLimitHit = true;
            }
            // Don't throw the error for JSON parsing issues, just skip the headline
            if (!error.message.includes('skipping')) {
              throw new Error(error.message);
            }
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

// Function to parse AI response and extract headline and summary
function parseAIResponse(result) {
  let newHeadline, summary;
  
  // Clean the result first - remove markdown code blocks if present
  let cleanResult = result.trim();
  if (cleanResult.startsWith('```json')) {
    cleanResult = cleanResult.replace(/```json\s*/, '').replace(/\s*```$/, '');
  }
  if (cleanResult.startsWith('```')) {
    cleanResult = cleanResult.replace(/```\s*/, '').replace(/\s*```$/, '');
  }
  
  try {
    // Try to parse as JSON
    const parsed = JSON.parse(cleanResult);
    newHeadline = parsed.new_headline || parsed.headline || parsed.title;
    summary = parsed.article_summary || parsed.summary || parsed.description;
    
    // If we don't have both parts, throw error to trigger fallback
    if (!newHeadline || !summary) {
      throw new Error('Missing required fields in JSON');
    }
    
  } catch (e) {
    // Enhanced fallback: try to extract JSON from text with better patterns
    const jsonPatterns = [
      /\{[^{}]*"new_headline"[^{}]*"article_summary"[^{}]*\}/s,
      /\{[^{}]*"headline"[^{}]*"summary"[^{}]*\}/s,
      /\{.*?"new_headline".*?"article_summary".*?\}/s,
      /\{.*?"headline".*?"summary".*?\}/s,
      /\{[\s\S]*?"new_headline"[\s\S]*?"article_summary"[\s\S]*?\}/,
      /\{[\s\S]*?"headline"[\s\S]*?"summary"[\s\S]*?\}/
    ];
    
    let jsonFound = false;
    for (const pattern of jsonPatterns) {
      const match = result.match(pattern);
      if (match) {
        try {
          const extracted = JSON.parse(match[0]);
          newHeadline = extracted.new_headline || extracted.headline || extracted.title;
          summary = extracted.article_summary || extracted.summary || extracted.description;
          
          if (newHeadline && summary) {
            jsonFound = true;
            break;
          }
        } catch (e2) {
          continue; // Try next pattern
        }
      }
    }
    
    // If no valid JSON found, skip this headline to prevent showing raw JSON
    if (!jsonFound) {
      throw new Error('Unable to parse AI response - skipping headline');
    }
  }
  
  // Validate headline doesn't look like JSON
  if (newHeadline.includes('{') || newHeadline.includes('"new_headline"')) {
    throw new Error('Headline appears to be malformed JSON - skipping');
  }
  
  // Clean and validate the headline
  if (typeof newHeadline !== 'string' || newHeadline.trim() === '') {
    throw new Error('Invalid headline format - skipping');
  }
  
  const sanitizedHeadline = newHeadline.replace(/[\r\n]+/g, ' ').trim();
  
  // Clean the summary
  if (typeof summary === 'string') {
    summary = summary.replace(/[\r\n]+/g, ' ').trim();
    // Limit summary length
    if (summary.length > 300) {
      summary = summary.substring(0, 297) + '...';
    }
  } else {
    summary = 'Summary unavailable';
  }
  
  return { headline: sanitizedHeadline, summary: summary };
}


function typeHeadline(element, text) {
  let index = 0;
  element.textContent = '';
  const interval = setInterval(() => {
    if (index < text.length) {
      element.textContent += text[index];
      index++;
    } else {
      clearInterval(interval);
      // Add tooltip functionality after typing is complete
      setupTooltip(element);
    }
  }, 50); // Adjust typing speed by changing the interval time
}

// Setup tooltip functionality for a processed headline
function setupTooltip(element) {
  element.classList.add('just-news-processed-headline');
  
  let tooltip = null;
  let tooltipTimeout = null;
  const articleUrl = element.href || element.closest('a')?.href;
  
  if (!articleUrl) return;
  
  element.addEventListener('mouseenter', () => {
    // Clear any existing timeout
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
    }
    
    // Add delay before showing tooltip
    tooltipTimeout = setTimeout(() => {
      // Create tooltip
      tooltip = document.createElement('div');
      tooltip.className = 'just-news-tooltip';
      
      // Get cached summary (should already be available from initial API call)
      if (articleSummaries.has(articleUrl)) {
        const summary = articleSummaries.get(articleUrl);
        tooltip.textContent = summary;
      } else {
        tooltip.textContent = 'Summary unavailable';
      }
      
      document.body.appendChild(tooltip);
      
      // Position tooltip after a small delay to ensure it's rendered
      setTimeout(() => {
        positionTooltip(element, tooltip);
        
        // Show tooltip
        tooltip.classList.add('show');
      }, 10);
    }, 500); // 500ms delay before showing tooltip
  });
  
  element.addEventListener('mouseleave', () => {
    // Clear timeout if mouse leaves before tooltip shows
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    
    if (tooltip && tooltip.parentNode) {
      tooltip.classList.remove('show');
      setTimeout(() => {
        if (tooltip && tooltip.parentNode) {
          document.body.removeChild(tooltip);
        }
      }, 300);
      tooltip = null;
    }
  });
}

// Position tooltip relative to the element and mouse
function positionTooltip(element, tooltip, mouseEvent = null) {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let x, y;
  
  // Always position tooltip centered under the headline
  x = rect.left + (rect.width / 2);
  y = rect.bottom + 10;
  
  // Make sure tooltip stays within viewport
  const tooltipWidth = 350; // max-width from CSS
  const tooltipHeight = 100; // estimate
  
  // Center the tooltip horizontally relative to its own width
  x = x - (tooltipWidth / 2);
  
  // Adjust if tooltip goes off screen horizontally
  if (x + tooltipWidth > viewportWidth - 10) {
    x = viewportWidth - tooltipWidth - 10;
  }
  if (x < 10) {
    x = 10;
  }
  
  // Adjust if tooltip goes off screen vertically
  if (y + tooltipHeight > viewportHeight - 10) {
    y = rect.top - tooltipHeight - 10;
  }
  if (y < 10) {
    y = rect.bottom + 10;
  }
  
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
  tooltip.style.position = 'fixed';
  tooltip.style.zIndex = '10000';
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
  
  // System-controlled instructions that users cannot modify
  const systemInstructions = `

Original: ${sourceHeadline}
Article: ${content}

IMPORTANT: You must return your response in this exact JSON format:
{"new_headline": "<your rewritten headline>", "article_summary": "<2-3 sentence objective summary of the article>"}

Do not add any text before or after the JSON. Only return the JSON object.`;
  
  const prompt = customPrompt + systemInstructions;
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