// TODO: Move premium handling to server side
// TODO: move all model, summary and prompt to server side (and change temperature according to mode)
// TODO: Add option to automatically replace headlines when entering news website
// TODO: Support in-article title replacement
// TODO: Implement some caching mechanism (inside extension)?
// TODO: Add clean mode

let premium = false; // Track premium status
let isInitialized = false;
let counter = 0;
let articleSummaries = new Map(); // Cache for article summaries
let ipu = false;
let isLoginPromptShown = false; // Prevent duplicate login prompts
let userSelectedElement = null; // Store user's selected headline element

// Function to initialize premium status - only called once during startup
async function initializePremiumStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkPremium' });
    ipu = response.ipb;
    console.log('Premium status initialized:', ipu);
  } catch (error) {
    console.log('Error checking premium status:', error);
    ipu = false;
  }
}

// Sync function to check premium status - uses cached value
function ipb() {
  return ipu;
}

async function initializeContentScript() {
  if (isInitialized) return;
  
  // Initialize premium status
  await initializePremiumStatus();
  
  // Add tooltip styles to the page
  addTooltipStyles();

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarizeHeadlines') {
      counter = 0;
      // Capture user's selected element before processing
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        userSelectedElement = range.commonAncestorContainer;
        // If it's a text node, get its parent element
        if (userSelectedElement.nodeType === 3) {
          userSelectedElement = userSelectedElement.parentElement;
        }
      } else {
        userSelectedElement = null;
      }
      summarizeHeadlines();
      sendResponse({status: 'Processing started'});
    } else if (request.action === 'premiumStatusChanged') {
      // Update cached premium status when it changes
      ipu = request.ipb;
      console.log('Premium status updated:', ipu);
      sendResponse({status: 'premium status updated'});
    } else if (request.action === 'promptLogin') {
      // Show login prompt
      showLoginPrompt();
      sendResponse({status: 'login prompt shown'});
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
  let model = "";
  let customPrompt = "";
  let systemPrompt = "";
  let preferedLang = "english";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

- Robotic, factual, no clickbait
- Summarize the key point of the article
- Keep the original language (if Hebrew, give new Hebrew title) and similar length
- Be objective and informative`;

  try {
    const settings = await chrome.storage.sync.get(['model', 'customPrompt', 'systemPrompt', 'preferedLang']);
    model = settings.model || "meta-llama/llama-4-scout-17b-16e-instruct";
    customPrompt = settings.customPrompt || defaultPrompt;
    systemPrompt = settings.systemPrompt || defaultSystemPrompt;
    preferedLang = settings.preferedLang || "english";
  } catch (error) {
    await createNotification('Error loading settings. Please try again.');
  }
  const apiOptions = {"model": model, "customPrompt": customPrompt, "systemPrompt": systemPrompt, "preferedLang": preferedLang}; 

  const limit = 20; // Maximum headlines per click
  let firstHeadlineChanged = false;

  // This function will be injected into the page
  let headlines = Array.from(document.querySelectorAll('a, a span, h1, h2, h3, h4, h5, h6, span[class*="title"], span[class*="title"], strong[data-type*="title"], span[class*="headline"], strong[data-type*="headline"], span[data-type*="title"], strong[class*="title"], span[data-type*="headline"], strong[class*="headline"], span[class*="Title"], strong[data-type*="Title"], span[class*="Headline"], strong[data-type*="Headline"], span[data-type*="Title"], strong[class*="Title"], span[data-type*="Headline"], strong[class*="Headline"]'));
  
  // Filter out headlines with images
  headlines = headlines.filter(headline => !headline.querySelector('img'));

  //filter out processed headlines
  headlines = headlines.filter(headline => !headline.textContent.includes('~'));
  
  //filter out already processed elements (with our class)
  headlines = headlines.filter(headline => !headline.classList.contains('just-news-processed-headline'));

  //filter out duplicated headlines and nested elements
  const uniqueHeadlines = new Set();
  const processedElements = new Set();
  headlines = headlines.filter(headline => {
    // Skip if this element or its parent/child was already processed
    if (processedElements.has(headline)) return false;
    
    // Check if any parent element was already selected
    let parent = headline.parentElement;
    while (parent) {
      if (processedElements.has(parent)) return false;
      parent = parent.parentElement;
    }
    
    // Check if any child element was already selected
    const descendants = headline.querySelectorAll('*');
    for (let descendant of descendants) {
      if (processedElements.has(descendant)) return false;
    }
    
    const text = headline.textContent.trim();
    if (uniqueHeadlines.has(text)) {
      return false;
    }
    
    uniqueHeadlines.add(text);
    processedElements.add(headline);
    return true;
  });

  // Filter out headlines that are not visible in the viewport
  headlines = headlines.filter(headline => {
    const rect = headline.getBoundingClientRect();
    const style = window.getComputedStyle(headline);
    
    // Check if headline is at least partially visible in viewport
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      return false;
    }
    
    // Check if element is hidden via CSS
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0 || rect.width === 0 || rect.height === 0) {
      return false;
    }
    
    return true;
  });

  // Filter out subject headlines
  headlines = headlines.filter(headline => headline.textContent.split(' ').length > 3);

  // Prioritize user-selected headline if exists
  if (userSelectedElement) {
    // Find if the selected element is in our headlines list, or find its closest headline ancestor
    let selectedIndex = headlines.findIndex(h => h === userSelectedElement || h.contains(userSelectedElement));
    
    // If not found directly, check if selected element contains any headline
    if (selectedIndex === -1) {
      selectedIndex = headlines.findIndex(h => userSelectedElement.contains(h));
    }
    
    if (selectedIndex > 0) {
      // Move selected headline to the front
      const selectedHeadline = headlines.splice(selectedIndex, 1)[0];
      headlines.unshift(selectedHeadline);
    }
    // Clear selection after use
    userSelectedElement = null;
  }

  // Sort headlines by font size in descending order (keep first item if it was user-selected)
  const firstHeadline = headlines[0];
  const restOfHeadlines = headlines.slice(1).sort((a, b) => {
    const fontSizeA = parseFloat(window.getComputedStyle(a).fontSize);
    const fontSizeB = parseFloat(window.getComputedStyle(b).fontSize);
    return fontSizeB - fontSizeA;
  });
  
  headlines = [firstHeadline, ...restOfHeadlines];

  // Process only the top <limit> headlines
  let rateLimitHit = false;
  let promises = [];
  for (let i = counter; i < Math.min(limit + counter, headlines.length); i++) {
    if (rateLimitHit) break;
    const headline = headlines[i];
    const sourceHeadline = headline.textContent;
    const articleUrl = headline.href || headline.closest('a')?.href || headline.querySelector('a')?.href;
    if (articleUrl) {
      promises.push(
        fetchSummary(sourceHeadline, articleUrl, apiOptions)
          .then(result => {
            // Parse the JSON response using dedicated function
            const { headline: newHeadline, summary } = parseAIResponse(result);
            
            // Cache the summary for tooltip use
            if (ipb()) {
              articleSummaries.set(articleUrl, summary);
            }

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
    let dailyQuotaExceeded = false;
    let rateLimitMessage = '';
    
    errors.forEach(e => {
      let msg = e.reason.message || '';
      if (msg.includes('Rate limit')) {
        hasRateLimit = true;
        rateLimitMessage = msg; // Store the message
        const match = msg.match(/Try again in (\d+)/);
        if (match) {
          const retry = parseInt(match[1], 10);
          if (minRetryAfter === null || retry < minRetryAfter) minRetryAfter = retry;
        }
      } else if (msg.includes('Daily quota exceeded')) {
        hasRateLimit = true;
        dailyQuotaExceeded = true;
      } else if (msg.includes('exceeded')) {
        hasRateLimit = true;
        rateLimitMessage = msg;
      }
    });
    
    if (hasRateLimit) {
      if (dailyQuotaExceeded) {
        await createPremiumNotification('Daily limit exceeded. Please upgrade to premium for more usage.');
      } else {
        // Format the retry message
        let displayMessage = rateLimitMessage;
        if (minRetryAfter !== null) {
          const minutes = Math.floor(minRetryAfter / 60);
          const seconds = minRetryAfter % 60;
          if (minutes > 0) {
            displayMessage = `Rate limit exceeded. Try again in ${minutes}m ${seconds}s`;
          } else {
            displayMessage = `Rate limit exceeded. Try again in ${seconds} seconds`;
          }
        }
        await createNotification(displayMessage);
      }
    } else {
      let errorTypes = new Set();
      errors.forEach(e => {
        let msg = e.reason.message || '';
        if (msg.includes('Error extracting article content')) {
          errorTypes.add('Error extracting article content');
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
function parseAIResponseOld(result) {
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
  
  let sanitizedHeadline = newHeadline
    .replace(/[\r\n]+/g, ' ')      // Replace newlines with spaces
    .replace(/\\"/g, '"')          // Fix escaped quotes first
    .replace(/"/g, "'")            // Replace double quotes with single quotes
    .replace(/\\/g, '')            // Remove remaining backslashes
    .trim();
  
  
  // Clean the summary
  if (typeof summary === 'string') {
    summary = summary.replace(/[\r\n]+/g, ' ').trim();
  } else {
    summary = 'Summary unavailable';
  }
  
  return { headline: sanitizedHeadline, summary: summary };
}

function parseAIResponseNew(result){
  // Handle the case where result might be an object with a 'text' property
  const text = typeof result === 'string' ? result : result?.text || result;
  
  if (!text) {
    throw new Error('No text to parse');
  }
  
  // Step 1: Try as valid JSON directly
  try {
    const parsed = JSON.parse(text);
    if (parsed.new_headline || parsed.headline || parsed.title) {
      return {
        headline: (parsed.new_headline || parsed.headline || parsed.title).replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, ''),
        summary: parsed.article_summary || parsed.summary || parsed.description || 'Summary not available'
      };
    }
  } catch (e) {
    console.log('Step 1 failed:', e.message);
  }
  
  // Step 2: Clean up markdown and try parsing JSON
  let cleanedText = text
    .replace(/```json\s*/g, '')  // Remove ```json
    .replace(/```\s*/g, '')      // Remove closing ```
    .replace(/,\s*}/g, '}')      // Fix trailing commas
    .trim();
  
  // Try parsing the cleaned text
  try {
    const parsed = JSON.parse(cleanedText);
    if (parsed.new_headline || parsed.headline || parsed.title) {
      const headline = (parsed.new_headline || parsed.headline || parsed.title).replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, '');
      return {
        headline: headline,
        summary: parsed.article_summary || parsed.summary || parsed.description || 'Summary not available'
      };
    }
  } catch (e) {
    // JSON is malformed, try to fix it by adding missing closing quote and brace
    let fixedText = cleanedText;
    if (!fixedText.endsWith('}')) {
      // Add missing closing quote if the last character isn't a quote
      if (!fixedText.endsWith('"')) {
        fixedText += '"';
      }
      // Add missing closing brace
      fixedText += '}';
    }
    
    try {
      const parsed = JSON.parse(fixedText);
      if (parsed.new_headline || parsed.headline || parsed.title) {
        const headline = (parsed.new_headline || parsed.headline || parsed.title).replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, '');
        return {
          headline: headline,
          summary: parsed.article_summary || parsed.summary || parsed.description || 'Summary not available'
        };
      }
    } catch (e2) {
      // Still failed, continue to next step
    }
  }
    
  // Step 3: Try to find and parse just the JSON part
  const jsonMatch = cleanedText.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.new_headline || parsed.headline || parsed.title) {
        return {
          headline: (parsed.new_headline || parsed.headline || parsed.title).replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, ''),
          summary: parsed.article_summary || parsed.summary || parsed.description || 'Summary not available'
        };
      }
    } catch (e) {
      console.log('Step 3 failed:', e.message);
    }
  }
  
  // Step 4: Manual text extraction as absolute last resort
  const headline = extractFirstFieldValue(text, 'new_headline');
  
  if (headline) {
    const summary = extractSecondFieldValue(text, 'article_summary');

    return {
      headline: headline.replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, ''),
      summary: summary || 'Summary not available'
    };
  }
  
  throw new Error('Could not extract headline from AI response');
}

/**
 * Robust 3-step parser that handles quotes and slashes properly
 * @param {string} result - Pre-cleaned result string
 * @returns {object} - {headline: string, summary: string}
 */
function parseAIResponse(result) {
  try {
    return parseAIResponseOld(result);
  } catch {
    return parseAIResponseNew(result);
  }
}

/**
 * Extract field value from text - handles quotes and slashes properly
 */
function extractFirstFieldValue(text, fieldName) {
  // Don't clean backslashes yet - work with original text
  const fieldPattern = `"${fieldName}": "`;
  const fieldStart = text.indexOf(fieldPattern);
  if (fieldStart === -1) return null;
  
  const valueStart = fieldStart + fieldPattern.length;
  
  // Find the closing quote by looking for the pattern: ", "article_summary"
  // or the pattern: "\n}\n``` (end of JSON)
  let valueEnd = text.indexOf('", "article_summary"', valueStart);
  if (valueEnd === -1) {
    valueEnd = text.indexOf('",\n  "article_summary"', valueStart);
  }
  if (valueEnd === -1) {
    valueEnd = text.indexOf('"\n}', valueStart);
  }
  if (valueEnd === -1) {
    // Last resort - find end of text
    valueEnd = text.length;
  }
  
  let value = text.substring(valueStart, valueEnd);
  
  // Now clean the extracted value
  value = value.replace(/\\"/g, '"').replace(/\\/g, '');
  
  return value;
}

function extractSecondFieldValue(text, fieldName) {
  const fieldPattern = `"${fieldName}": "`;
  const fieldStart = text.indexOf(fieldPattern);
  if (fieldStart === -1) return null;
  
  const valueStart = fieldStart + fieldPattern.length;
  
  // Find the closing quote by looking for end patterns
  let valueEnd = text.indexOf('"\n}', valueStart);
  if (valueEnd === -1) {
    valueEnd = text.indexOf('"}', valueStart);
  }
  if (valueEnd === -1) {
    // Last resort - find end of text
    valueEnd = text.length;
  }
  
  let value = text.substring(valueStart, valueEnd);
  
  // Clean the extracted value
  value = value.replace(/\\"/g, '"').replace(/\\/g, '');
  
  return value;
}

/**
 * Try to fix malformed JSON
 */



function typeHeadline(element, text) {
  // Mark the element as processed immediately to prevent double-processing
  element.classList.add('just-news-processed-headline');
  
  // Find the actual text element to replace
  // Priority: span with text, direct text node, or the element itself
  let targetElement = element;
  
  // Look for text-containing spans first
  const textSpan = element.querySelector('span');
  if (textSpan && textSpan.textContent.trim()) {
    targetElement = textSpan;
  } else {
    // Check if the element contains a link with text
    const link = element.querySelector('a');
    if (link && link.textContent.trim()) {
      // If the link has a span inside, target that
      const linkSpan = link.querySelector('span');
      if (linkSpan && linkSpan.textContent.trim()) {
        targetElement = linkSpan;
      } else {
        // Target the link directly
        targetElement = link;
      }
    }
  }
  
  let index = 0;
  targetElement.textContent = '';
  const interval = setInterval(() => {
    if (index < text.length) {
      targetElement.textContent += text[index];
      index++;
    } else {
      clearInterval(interval);
      // Add tooltip functionality after typing is complete
      if (ipb()) {
        setupTooltip(element);
      }
    }
  }, 50); // Adjust typing speed by changing the interval time
}

// Setup tooltip functionality for a processed headline
function setupTooltip(element) {
  // Element is already marked as processed by typeHeadline function
  
  let tooltip = null;
  let tooltipTimeout = null;
  const articleUrl = element.href || element.closest('a')?.href || element.querySelector('a')?.href;
  
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
  const { model, customPrompt, systemPrompt, preferedLang } = options;
  
  // System-controlled instructions that users cannot modify
  const systemInstructions = `

Original: ${sourceHeadline}
Article: ${content}

IMPORTANT: You must return your response in this exact JSON format:
{"new_headline": "<your rewritten headline>", "article_summary": "<2-3 sentence objective summary of the article>"}

Do not add any text before or after the JSON. Only return the JSON object.`;

  let prompt = customPrompt;
  if (preferedLang != 'english') {
    prompt += `(if ${preferedLang} generate ${preferedLang} headline).`;
  } 
  prompt += systemInstructions;
  const response = await chrome.runtime.sendMessage({
    action: 'AIcall',
    sourceHeadline,
    prompt,
    model,
    systemPrompt
  });
  if (!response || response?.error || !response.summary) {
    const errorMsg = response?.error || 'Unknown error';
    // Check if authentication failed - prompt user to login again (only once)
    if (errorMsg.includes('Authentication failed') || errorMsg.includes('sign in again')) {
      if (!isLoginPromptShown) {
        isLoginPromptShown = true;
        showLoginPrompt();
      }
      throw new Error('Session expired. Please sign in.');
    } else if (errorMsg.includes('exceeded')) {
      throw new Error(errorMsg);
    }
    throw new Error('Error fetching AI summary ' + errorMsg);
  }
  return response.summary;
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    backdrop-filter: blur(3px);
    direction: ltr;
  `;

  const promptBox = document.createElement('div');
  promptBox.style.cssText = `
    background: white;
    padding: 28px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    width: 90%;
    max-width: 400px;
    box-sizing: border-box;
    animation: slideIn 0.3s ease;
    min-height: 160px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    direction: ltr;
    text-align: left;
  `;

  const title = document.createElement('h3');
  title.textContent = message;
  title.style.cssText = `
    text-align: center;
    color: #333;
    margin: 0 0 20px 0;
    font-size: 16px;
    line-height: 1.6;
    font-weight: normal;
    white-space: pre-line;
    direction: ltr;
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    direction: ltr;
    justify-content: center;
    align-items: center;
    gap: 12px;
  `;

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'OK';
  cancelButton.style.cssText = `
    background: #4285F4;
    color: white;
    border: none;
    padding: 10px 24px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    direction: ltr;
  `;

  cancelButton.onmouseover = () => {
    cancelButton.style.background = '#1a73e8';
    cancelButton.style.transform = 'translateY(-1px)';
  };
  cancelButton.onmouseout = () => {
    cancelButton.style.background = '#4285F4';
    cancelButton.style.transform = 'translateY(0)';
  };

  // Add style for animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes gradientShift {
      0% { background-position: 0% 50% }
      50% { background-position: 100% 50% }
      100% { background-position: 0% 50% }
    }
  `;
  document.head.appendChild(style);

  buttonContainer.appendChild(cancelButton);
  promptBox.appendChild(title);
  promptBox.appendChild(buttonContainer);
  overlay.appendChild(promptBox);

  return { overlay, cancelButton };
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

// Show login prompt to user
function showLoginPrompt() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    backdrop-filter: blur(4px);
    direction: ltr;
    animation: fadeIn 0.2s ease;
  `;

  const promptBox = document.createElement('div');
  promptBox.style.cssText = `
    background: white;
    padding: 48px 40px 40px 40px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
    width: 90%;
    max-width: 440px;
    box-sizing: border-box;
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    direction: ltr;
    text-align: center;
    position: relative;
  `;

  // Logo/Icon at the top
  const iconContainer = document.createElement('div');
  iconContainer.style.cssText = `
    width: 48px;
    height: 48px;
    margin: 0 auto 20px auto;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  `;
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/icon128.png');
  icon.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 12px;
  `;
  iconContainer.appendChild(icon);

  const title = document.createElement('h3');
  title.textContent = 'Welcome to Just News';
  title.style.cssText = `
    text-align: center;
    font-size: 24px;
    color: #1a1a1a;
    font-weight: 600;
    margin: 0 0 12px 0;
    line-height: 1.3;
    letter-spacing: -0.3px;
  `;

  // Removed the 'Sign in to start removing clickbait' message for a cleaner UI


  // --- Mode Selector (Robot/Clean) ---
  const modeSelectorContainer = document.createElement('div');
  modeSelectorContainer.className = 'jn-mode-selector';
  modeSelectorContainer.style.cssText = `
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    margin-bottom: 14px;
    margin-top: 0;
    transform: scale(1);
    opacity: 1;
    filter: none;
    transition: all 0.2s;
  `;

  // Inject CSS for .jn-mode-btn and .jn-mode-btn.selected
  if (!document.getElementById('jn-mode-btn-style')) {
    const style = document.createElement('style');
    style.id = 'jn-mode-btn-style';
    style.textContent = `
      .jn-mode-btn {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        background: white; border: 2px solid transparent; border-radius: 14px; padding: 18px 18px 14px 18px; min-width: 110px; min-height: 110px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 12px rgba(66,133,244,0.10);
        margin: 0 6px;
      }
      .jn-mode-btn.selected {
        background: #4285F4 !important; color: white !important; box-shadow: 0 6px 24px rgba(66,133,244,0.25) !important; border-color: #4285F4 !important;
      }
      .jn-mode-btn.selected img { filter: brightness(0) invert(1) !important; }
      .jn-mode-btn.selected span { color: white !important; }
      .jn-mode-btn img { width:48px; height:48px; margin-bottom:12px; }
      .jn-mode-btn span { font-weight:700; font-size:1.18em; color:#333; margin-bottom: 4px; }
      .jn-mode-btn .jn-desc { font-size:1em; opacity:0.85; color:#333; font-weight:400; margin-bottom:0; text-align:center; }
      .jn-mode-selector { gap: 16px !important; }
      @media (max-width: 600px) {
        .jn-mode-btn { min-width: 80px; min-height: 80px; padding: 10px 6px 8px 6px; }
        .jn-mode-btn img { width:32px; height:32px; margin-bottom:6px; }
        .jn-mode-btn span { font-size:1em; }
        .jn-mode-btn .jn-desc { font-size:0.85em; }
      }
    `;
    document.head.appendChild(style);
  }

  // Mode configs (same as options.js)
  const characterConfigs = {
    robot: {
      systemPrompt: "Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.",
      userPrompt: "Rewrite the headline, based on the article, with these rules:\n\n- Robotic, factual, no clickbait\n- Summarize the key point of the article\n- Be objective and informative\n Keep the original headline length and language"
    },
    clean: {
      systemPrompt: "You are a guardian of ethical and family-friendly speech according to Jewish laws of Lashon Hara (evil speech). You rewrite headlines to remove gossip, slander, negativity about individuals, harmful speech, profanity, swear words, violence, sexual content, and any content inappropriate for all ages. Focus on constructive, respectful, and clean language that avoids speaking negatively about people. Even don't wrtite any name of person, just generalize it. Still make the headline informative and summerizing the main point of the article, while adhering to these ethical guidelines.",
      userPrompt: "Rewrite this headline according to Jewish laws against Lashon Hara (evil speech) and remove all inappropriate content. Remove:\n- Gossip, slander, or negative speech about individuals\n- Profanity and swear words\n- Violent or graphic descriptions\n- Sexual content or references\n- Any content not suitable for all ages\n\nFocus only on essential facts presented respectfully and appropriately. If the article contains only inappropriate content with no constructive value, note that it violates speech ethics.\n\nYour answer must be in the original headline length and in the article language."
    }
  };
  let currentMode = 'robot';

  // Mode button factory
  function createModeButton(mode, iconUrl, label, desc) {
    const btn = document.createElement('div');
    btn.className = 'jn-mode-btn' + (mode === currentMode ? ' selected' : '');

    // Create image element and set src using chrome.runtime.getURL
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = label;

    // Create label and description
    const nameSpan = document.createElement('span');
    nameSpan.textContent = label;
    const descSpan = document.createElement('span');
    descSpan.textContent = desc;
    descSpan.className = 'jn-desc';

    // Append children
    btn.appendChild(img);
    btn.appendChild(nameSpan);
    btn.appendChild(descSpan);

    btn.onclick = () => {
      if (currentMode === mode) return;
      currentMode = mode;
      // Update UI selection
      Array.from(modeSelectorContainer.children).forEach(child => child.classList.remove('selected'));
      btn.classList.add('selected');
      // Save prompts to storage
      chrome.storage.sync.set({
        characterMode: mode,
        systemPrompt: characterConfigs[mode].systemPrompt,
        customPrompt: characterConfigs[mode].userPrompt
      });
    };
    return btn;
  }

  // Add Robot and Clean mode buttons
  modeSelectorContainer.appendChild(createModeButton('robot', chrome.runtime.getURL('icons2/robot.png'), 'Robot', 'Factual & objective'));
  modeSelectorContainer.appendChild(createModeButton('clean', chrome.runtime.getURL('icons2/clean.png'), 'Clean', 'Family-friendly'));
  // --- End Mode Selector ---

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  `;

  const loginButton = document.createElement('button');
  loginButton.innerHTML = `
    <span style="display:flex;align-items:center;gap:7px;justify-content:center;">
      <svg style="width: 20px; height: 20px; flex-shrink: 0;" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        <path fill="none" d="M0 0h48v48H0z"/>
      </svg>
      <span style="font-size:1em;">Continue with Google</span>
    </span>
  `;
  loginButton.style.cssText = `
    background: white;
    color: #3c4043;
    border: 1px solid #dadce0;
    padding: 14px 24px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    font-family: inherit;
  `;

  loginButton.onmouseover = () => {
    loginButton.style.background = '#f8f9fa';
    loginButton.style.borderColor = '#d2d3d4';
    loginButton.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
  };
  loginButton.onmouseout = () => {
    loginButton.style.background = 'white';
    loginButton.style.borderColor = '#dadce0';
    loginButton.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
  };

  // Add X close button in the top right corner
  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.style.cssText = `
    position: absolute;
    top: 12px;
    right: 12px;
    background: transparent;
    border: none;
    color: #888;
    font-size: 2.1rem;
    font-weight: 700;
    cursor: pointer;
    z-index: 10;
    line-height: 1;
    padding: 0 6px;
    transition: color 0.2s;
  `;
  closeButton.onmouseover = () => { closeButton.style.color = '#4285F4'; };
  closeButton.onmouseout = () => { closeButton.style.color = '#888'; };
  closeButton.onclick = () => {
    overlay.remove();
    isLoginPromptShown = false;
  };

  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    loginButton.textContent = 'Signing in...';
    // Save current mode prompts before login
    chrome.storage.sync.set({
      characterMode: currentMode,
      systemPrompt: characterConfigs[currentMode].systemPrompt,
      customPrompt: characterConfigs[currentMode].userPrompt
    }, async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'login' });
        if (response.success) {
          overlay.remove();
          isLoginPromptShown = false; // Reset flag on successful login
          // Trigger headline summarization
          summarizeHeadlines();
        } else {
          await createNotification('Login failed: ' + response.error);
          overlay.remove();
          isLoginPromptShown = false; // Reset flag on failure
        }
      } catch (error) {
        await createNotification('Login error: ' + error.message);
        overlay.remove();
        isLoginPromptShown = false; // Reset flag on error
      }
    });
  });

  buttonContainer.appendChild(loginButton);
  // Insert close button in the corner
  promptBox.appendChild(closeButton);
  promptBox.appendChild(iconContainer);
  promptBox.appendChild(title);
  // Removed message for a cleaner UI

  // Removed the stepper (1>2 icon) for a cleaner UI

  // Highlight mode selection area (now smaller and less prominent)
  const modeSection = document.createElement('div');
  modeSection.style.cssText = 'background:#f6faff;border-radius:10px;padding:8px 2px 4px 2px;margin-bottom:10px;box-shadow:0 1px 4px rgba(66,133,244,0.03);';
  const modeLabel = document.createElement('div');
  modeLabel.textContent = 'Choose your mode:';
  modeLabel.style.cssText = 'text-align:center;font-size:0.98em;color:#4285F4;font-weight:500;margin-bottom:4px;opacity:0.7;';
  modeSection.appendChild(modeLabel);
  modeSection.appendChild(modeSelectorContainer);
  promptBox.appendChild(modeSection);

  // Step 2: Sign in (now more prominent)
  const signInSection = document.createElement('div');
  signInSection.style.cssText = 'text-align:center;margin-bottom:0;margin-top:0;';
  const signInLabel = document.createElement('div');
  signInLabel.textContent = 'Sign in with Google';
  signInLabel.style.cssText = 'font-size:1.22em;color:#1a1a1a;font-weight:800;margin-bottom:16px;letter-spacing:-0.5px;text-shadow:0 2px 8px rgba(66,133,244,0.08);';
  signInSection.appendChild(signInLabel);
  // Make login button larger and bolder
  loginButton.style.padding = '20px 32px';
  loginButton.style.fontSize = '1.18em';
  loginButton.style.fontWeight = '700';
  loginButton.style.borderRadius = '12px';
  loginButton.style.boxShadow = '0 4px 16px rgba(66,133,244,0.10)';
  loginButton.style.margin = '0 auto 0 auto';
  loginButton.style.maxWidth = '340px';
  loginButton.style.display = 'flex';
  loginButton.style.alignItems = 'center';
  loginButton.style.justifyContent = 'center';
  loginButton.style.gap = '12px';
  signInSection.appendChild(buttonContainer);
  promptBox.appendChild(signInSection);
  overlay.appendChild(promptBox);
  document.body.appendChild(overlay);
}

// Show premium upgrade notification with styled "Maybe later" button
function createPremiumNotification(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      backdrop-filter: blur(4px);
      direction: ltr;
      animation: fadeIn 0.2s ease;
    `;

    const notificationBox = document.createElement('div');
    notificationBox.style.cssText = `
      background: white;
      padding: 48px 40px 40px 40px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
      width: 90%;
      max-width: 440px;
      box-sizing: border-box;
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      direction: ltr;
      text-align: center;
      position: relative;
    `;

    // Icon at the top
    const iconContainer = document.createElement('div');
    iconContainer.style.cssText = `
      width: 48px;
      height: 48px;
      margin: 0 auto 20px auto;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    `;
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon128.png');
    icon.style.cssText = `
      width: 48px;
      height: 48px;
      border-radius: 12px;
    `;
    iconContainer.appendChild(icon);

    const title = document.createElement('h3');
    title.textContent = 'Daily Limit Reached';
    title.style.cssText = `
      text-align: center;
      font-size: 24px;
      color: #1a1a1a;
      font-weight: 600;
      margin: 0 0 12px 0;
      line-height: 1.3;
      letter-spacing: -0.3px;
    `;

    const messageText = document.createElement('p');
    messageText.textContent = message;
    messageText.style.cssText = `
      text-align: center;
      font-size: 15px;
      color: #666;
      margin: 0 0 32px 0;
      line-height: 1.5;
      font-weight: 400;
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
    `;

    // Upgrade to Premium button with gradient animation
    const upgradeButton = document.createElement('a');
    upgradeButton.href = 'https://tsurdan.github.io/Just-News/premium.html';
    upgradeButton.target = '_blank';
    upgradeButton.style.cssText = `
      position: relative;
      padding: 2px;
      border-radius: 30px;
      background: linear-gradient(135deg, 
        #8A2BE2 0%,
        #58CC02 25%,
        #6200EE 50%,
        #58CC02 75%,
        #8A2BE2 100%
      );
      background-size: 300% 300%;
      animation: gradientShift 8s linear infinite;
      text-decoration: none;
      cursor: pointer;
      direction: ltr;
      width: 100%;
      box-sizing: border-box;
    `;

    const upgradeSpan = document.createElement('span');
    upgradeSpan.textContent = 'Upgrade to Premium';
    upgradeSpan.style.cssText = `
      display: block;
      background: transparent;
      color: white;
      padding: 14px 24px;
      border-radius: 28px;
      font-size: 15px;
      font-weight: 600;
      transition: all 0.3s ease;
      direction: ltr;
      text-align: center;
    `;

    upgradeButton.appendChild(upgradeSpan);
    upgradeButton.onmouseover = () => {
      upgradeSpan.style.background = 'white';
      upgradeSpan.style.color = '#6200EE';
    };
    upgradeButton.onmouseout = () => {
      upgradeSpan.style.background = 'transparent';
      upgradeSpan.style.color = 'white';
    };

    // Add gradient animation style if not already added
    if (!document.getElementById('premium-gradient-animation')) {
      const style = document.createElement('style');
      style.id = 'premium-gradient-animation';
      style.textContent = `
        @keyframes gradientShift {
          0% { background-position: 0% 50% }
          50% { background-position: 100% 50% }
          100% { background-position: 0% 50% }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    const maybeLaterButton = document.createElement('button');
    maybeLaterButton.textContent = 'Maybe later';
    maybeLaterButton.style.cssText = `
      background: transparent;
      color: #5f6368;
      border: none;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    `;

    maybeLaterButton.onmouseover = () => {
      maybeLaterButton.style.background = '#f8f9fa';
      maybeLaterButton.style.color = '#3c4043';
    };
    maybeLaterButton.onmouseout = () => {
      maybeLaterButton.style.background = 'transparent';
      maybeLaterButton.style.color = '#5f6368';
    };

    maybeLaterButton.addEventListener('click', () => {
      overlay.remove();
      resolve();
    });

    buttonContainer.appendChild(upgradeButton);
    buttonContainer.appendChild(maybeLaterButton);
    notificationBox.appendChild(iconContainer);
    notificationBox.appendChild(title);
    notificationBox.appendChild(messageText);
    notificationBox.appendChild(buttonContainer);
    overlay.appendChild(notificationBox);
    document.body.appendChild(overlay);
  });
}


initializeContentScript();