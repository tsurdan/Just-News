// Cache configuration
const CACHE_PREFIX = 'justnews_cache_';
const CACHE_TTL_DAYS = 1; // Cache expires after 1 day
const MAX_CACHE_ENTRIES = 500; // Limit cache size to prevent storage bloat
const CACHE_VERSION = 'v1'; // Increment to invalidate old cache format
const MAX_CACHE_ENTRY_SIZE = 3000; // Max bytes per cache entry

let premium = false; // Track premium status
let isInitialized = false;
let counter = 0;
let articleSummaries = new Map(); // Cache for article summaries
let ipu = false;
let autoReplaceHeadlines = false; // Default: disabled
let lastScrollY = 0;
let scrollProcessingTimeout = null;
let isAutomaticProcessing = false;
let rateLimitedUntil = 0;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const DAILY_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

// ============= CACHE UTILITIES =============

function generateCacheKey(url, headline, apiOptions = {}) {
  const normalizedUrl = url.split('?')[0].split('#')[0];
  const headlineHash = simpleHash(headline.trim().toLowerCase());
  
  const settingsString = JSON.stringify({
    mode: apiOptions.mode || 'robot',
    customPrompt: apiOptions.customPrompt || '',
    systemPrompt: apiOptions.systemPrompt || '',
    preferedLang: apiOptions.preferedLang || 'hebrew'
  });
  const settingsHash = simpleHash(settingsString);
  
  return `${CACHE_PREFIX}${CACHE_VERSION}_${normalizedUrl}_${headlineHash}_${settingsHash}`;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

async function getCachedHeadline(url, originalHeadline, apiOptions = {}) {
  try {
    const cacheKey = generateCacheKey(url, originalHeadline, apiOptions);
    const result = await chrome.storage.local.get(cacheKey);
    
    if (!result[cacheKey]) {
      return null;
    }
    
    const cached = result[cacheKey];
    const now = Date.now();
    const age = now - cached.timestamp;
    const maxAge = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    
    if (age > maxAge) {
      await chrome.storage.local.remove(cacheKey);
      return null;
    }
    
    return cached;
  } catch (error) {
    console.error('Error reading cache:', error);
    return null;
  }
}

async function setCachedHeadline(url, originalHeadline, newHeadline, summary, apiOptions = {}) {
  try {
    const cacheKey = generateCacheKey(url, originalHeadline, apiOptions);
    const cacheData = {
      url,
      originalHeadline,
      newHeadline,
      summary,
      timestamp: Date.now(),
      version: CACHE_VERSION
    };
    
    const approximateSize = JSON.stringify(cacheData).length;
    if (approximateSize > MAX_CACHE_ENTRY_SIZE) {
      return;
    }
    
    await chrome.storage.local.set({ [cacheKey]: cacheData });
    await cleanupCacheIfNeeded();
  } catch (error) {
    console.error('Error writing cache:', error);
  }
}

async function cleanupCacheIfNeeded() {
  try {
    const allData = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(allData).filter(key => key.startsWith(CACHE_PREFIX));
    
    if (cacheKeys.length < MAX_CACHE_ENTRIES) {
      return;
    }
    
    const now = Date.now();
    const maxAge = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    const entriesToRemove = [];
    const validEntries = [];
    
    for (const key of cacheKeys) {
      const entry = allData[key];
      if (!entry || !entry.timestamp) {
        entriesToRemove.push(key);
        continue;
      }
      
      const age = now - entry.timestamp;
      if (age > maxAge || entry.version !== CACHE_VERSION) {
        entriesToRemove.push(key);
      } else {
        validEntries.push({ key, timestamp: entry.timestamp });
      }
    }
    
    if (validEntries.length > MAX_CACHE_ENTRIES) {
      validEntries.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = validEntries.length - MAX_CACHE_ENTRIES;
      for (let i = 0; i < toRemove; i++) {
        entriesToRemove.push(validEntries[i].key);
      }
    }
    
    if (entriesToRemove.length > 0) {
      await chrome.storage.local.remove(entriesToRemove);
    }
  } catch (error) {
    console.error('Error during cache cleanup:', error);
  }
}

// ============= END CACHE UTILITIES =============

// Detect if we're on an article page
function isArticlePage() {
  // Check URL patterns that indicate article pages
  const url = window.location.href;
  const path = window.location.pathname;
  
  // Exclude known homepage patterns
  if (path === '/' || path === '' || path === '/index.html') return false;
  
  // Check for article-specific meta tags
  const ogType = document.querySelector('meta[property="og:type"]');
  if (ogType && ogType.content === 'article') return true;
  
  // Check for article schema
  const articleSchema = document.querySelector('[itemtype*="Article"], [itemtype*="NewsArticle"], [itemtype*="BlogPosting"]');
  if (articleSchema) return true;
  
  // Check for article-specific containers
  const articleContainer = document.querySelector('article.post, article.entry, article[role="article"], .article-body, .story-body, .post-content, .entry-content');
  if (articleContainer) {
    // Make sure it has substantial content (not just a card/teaser)
    const text = articleContainer.textContent.trim();
    if (text.length > 1000) return true;
  }
  
  // Fallback heuristic: exactly one h1 + many paragraphs with substantial text
  const h1Tags = document.querySelectorAll('h1');
  const paragraphs = document.querySelectorAll('article p, [role="article"] p, .article-content p, .post-content p, .entry-content p, .story-body p');
  
  if (h1Tags.length !== 1) return false;
  if (paragraphs.length < 5) return false;
  
  const paragraphText = Array.from(paragraphs)
    .map(p => p.textContent.trim())
    .join(' ');
  
  if (paragraphText.length < 1500) return false;
  
  // Check that there aren't too many links (homepage indicator)
  const links = document.querySelectorAll('a[href]');
  const h2s = document.querySelectorAll('h2, h3');
  // Homepages typically have many headline links relative to content
  if (h2s.length > 10 && links.length > 50) return false;
  
  return true;
}

// Extract article headline from article page
function extractArticleHeadline() {
  const selectors = [
    'h1[itemprop="headline"]',
    'h1.article-title',
    'h1.entry-title',
    'h1.post-title',
    'article h1',
    '[role="article"] h1',
    '.article-header h1',
    '.post-header h1',
    'h1',
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      return {
        element: element,
        text: element.textContent.trim()
      };
    }
  }
  
  return null;
}

// Extract article content from article page
function extractArticleContent() {
  const MAX_CONTENT_LENGTH = 4000;
  
  const articleSelectors = [
    '.article-body',
    '.ArticleBodyComponent',
    '.art_body',
    '.public-DraftEditor-content',
    '[data-testid="article-body"]',
    '.caas-body',
    'article .content',
    'article',
    '[role="article"]',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.story-body',
    'main',
  ];
  
  let articleContainer = null;
  for (const selector of articleSelectors) {
    articleContainer = document.querySelector(selector);
    if (articleContainer) break;
  }
  
  if (!articleContainer) {
    articleContainer = document.body;
  }
  
  const unwantedSelectors = [
    'script', 'style', 'nav', 'header', 'footer', 
    'aside', '.sidebar', '.advertisement', '.ad', 
    '.comments', '.related-articles',
    '[class*="taboola"]', '[id*="taboola"]',
    '[class*="outbrain"]', '[id*="outbrain"]',
    '.social-share', '.share-bar',
    '.newsletter', '.subscription',
  ];
  
  const clone = articleContainer.cloneNode(true);
  unwantedSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  const paragraphs = Array.from(clone.querySelectorAll('p'));
  let content = paragraphs.map(p => p.textContent.trim()).filter(t => t.length > 0).join(' ');
  
  if (!content || content.length < 100) {
    const textElements = Array.from(clone.querySelectorAll('div, span'));
    content = textElements
      .map(el => el.textContent.trim())
      .filter(t => t.length > 50)
      .join(' ');
  }
  
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.substring(0, MAX_CONTENT_LENGTH);
  }
  
  return content;
}

// Helper function to check if a headline is inside article paragraph content
function isInsideArticleParagraph(headline) {
  let element = headline;
  if (element.tagName === 'P') return true;
  
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    if (parent.tagName === 'P') return true;
    parent = parent.parentElement;
  }
  
  return false;
}

// Function to initialize premium status - only called once during startup
async function initializePremiumStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkPremium' });
    ipu = response.ipb;
  } catch (error) {
    ipu = false;
  }
}

// Sync function to check premium status - uses cached value
function ipb() {
  return ipu;
}

// Setup scroll listener to process headlines as user scrolls
function setupScrollListener() {
  let isProcessing = false;

  window.addEventListener('scroll', () => {
    if (!autoReplaceHeadlines || isProcessing) return;
    if (Date.now() < rateLimitedUntil) return;

    const currentScrollY = window.scrollY;
    const scrollDifference = Math.abs(currentScrollY - lastScrollY);

    if (scrollDifference > 300) {
      clearTimeout(scrollProcessingTimeout);
      scrollProcessingTimeout = setTimeout(async () => {
        isProcessing = true;
        isAutomaticProcessing = true;
        lastScrollY = currentScrollY;
        counter = 0;
        await summarizeHeadlines();
        isAutomaticProcessing = false;
        isProcessing = false;
      }, 500);
    }
  }, { passive: true });
}

async function initializeContentScript() {
  if (isInitialized) return;
  
  // Initialize premium status
  await initializePremiumStatus();
  
  // Load auto-replace setting (premium only)
  if (ipb()) {
    const data = await chrome.storage.sync.get(['autoReplaceHeadlines']);
    if (typeof data.autoReplaceHeadlines === 'boolean') {
      autoReplaceHeadlines = data.autoReplaceHeadlines;
    }
    
    if (autoReplaceHeadlines) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setTimeout(() => summarizeHeadlines(), 500);
        });
      } else {
        setTimeout(() => summarizeHeadlines(), 500);
      }
      setupScrollListener();
    } else {
      // Premium user with auto-replace off - remind them (once per day)
      checkAndShowReminderToast();
    }
  } else {
    // Non-premium user with API key - remind them (once per day)
    const { apiKey } = await chrome.storage.sync.get('apiKey');
    if (apiKey) {
      checkAndShowReminderToast();
    }
  }
  
  // Add tooltip styles to the page
  addTooltipStyles();

  // Listen for messages from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarizeHeadlines') {
      counter = 0;
      rateLimitedUntil = 0;
      summarizeHeadlines();
      sendResponse({status: 'Processing started'});
    } else if (request.action === 'premiumStatusChanged') {
      ipu = request.ipb;
      sendResponse({status: 'premium status updated'});
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
  // Check if this is an article page
  const isArticle = isArticlePage();
  
  // STEP 1: Always process linked headlines (homepage-style processing)
  try {
    await summarizeHomepageHeadlines(isArticle);
  } catch (error) {
    console.log('Error processing headlines: ' + error.message);
  }
  
  // STEP 2: Additionally check if this is an article page and process the main headline
  if (isArticle) {
    await summarizeArticleHeadline();
  }
}

// Handle article page headline replacement
async function summarizeArticleHeadline() {
  let apiKey = "";
  let apiProvider = "groq";
  let model = "";
  let customPrompt = "";
  let systemPrompt = "";
  let preferedLang = "hebrew";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

- Robotic, factual, no clickbait
- Summarize the key point of the article
- Keep the original language (if Hebrew, give new Hebrew title) and similar length
- Be objective and informative`;

  try {
    const settings = await chrome.storage.sync.get(['apiKey', 'apiProvider', 'model', 'customPrompt', 'systemPrompt', 'preferedLang', 'characterMode']);
    apiKey = settings.apiKey || "";
    apiProvider = settings.apiProvider || "groq";
    model = settings.model || "llama-3.3-70b-versatile";
    customPrompt = settings.customPrompt || defaultPrompt;
    systemPrompt = settings.systemPrompt || defaultSystemPrompt;
    preferedLang = settings.preferedLang || "hebrew";
    var characterMode = settings.characterMode || "robot";
    if (!apiKey) return; // No API key, skip article headline
  } catch (error) {
    return;
  }
  
  const articleUrl = window.location.href;
  const apiOptions = {"apiKey": apiKey, "apiProvider": apiProvider, "model": model, "customPrompt": customPrompt, "systemPrompt": systemPrompt, "preferedLang": preferedLang, "characterMode": characterMode};
  
  const headlineData = extractArticleHeadline();
  if (!headlineData) return;
  if (headlineData.text.startsWith('~')) return; // Already processed
  
  const content = extractArticleContent();
  if (!content || content.length < 100) return;
  
  const sourceHeadline = headlineData.text;
  const headlineElement = headlineData.element;
  
  // Check cache first
  const cached = await getCachedHeadline(articleUrl, sourceHeadline, apiOptions);
  if (cached) {
    typeHeadline(headlineElement, `~${cached.newHeadline}`, true);
    if (cached.summary) {
      articleSummaries.set(articleUrl, cached.summary);
      showArticleSummaryPanel(cached.summary);
    }
    chrome.runtime.sendMessage({ action: 'headlineChanged' });
    return;
  }
  
  // Check daily rate limit for free users
  if (!ipb()) {
    const limitCheck = await chrome.runtime.sendMessage({ action: 'checkDailyLimit' });
    if (!limitCheck.canProceed) return;
  }
  
  try {
    const summary = await summarizeContnet(sourceHeadline, content, apiOptions);
    const { headline: newHeadline, summary: articleSummary } = parseAIResponse(summary);
    
    await setCachedHeadline(articleUrl, sourceHeadline, newHeadline, articleSummary, apiOptions);
    
    typeHeadline(headlineElement, `~${newHeadline}`, false);
    
    if (articleSummary) {
      articleSummaries.set(articleUrl, articleSummary);
      showArticleSummaryPanel(articleSummary);
    }
    
    if (!ipb()) {
      chrome.runtime.sendMessage({ action: 'incrementDailyCount' }, (usage) => {});
    }
    
    chrome.runtime.sendMessage({ action: 'headlineChanged' });
  } catch (error) {
    // Silently skip errors for article headlines
  }
}

// Show article summary prominently by replacing article body
function showArticleSummaryPanel(summaryText) {
  if (!summaryText || summaryText === 'Summary unavailable' || summaryText === 'Summary not available') return;
  if (document.querySelector('.just-news-summary-panel')) return; // Already shown
  
  // Step 1: Find the article headline (h1) on the page
  const h1 = document.querySelector('article h1') ||
             document.querySelector('[role="article"] h1') ||
             document.querySelector('main h1') ||
             document.querySelector('h1');
  if (!h1) return;
  
  // Step 2: Walk up from h1 to find a wrapper that contains the article body content
  let articleWrapper = h1.parentElement;
  while (articleWrapper && articleWrapper !== document.body) {
    const pCount = articleWrapper.querySelectorAll('p').length;
    const hasBody = articleWrapper.querySelector('.article-body, .ArticleBodyComponent, .art_body, .public-DraftEditor-content');
    if (pCount >= 2 || hasBody) break;
    articleWrapper = articleWrapper.parentElement;
  }
  if (!articleWrapper || articleWrapper === document.body) return;
  
  // Create the panel
  const panel = document.createElement('div');
  panel.className = 'just-news-summary-panel';
  panel.style.cssText = `
    background: white;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    margin: 16px auto;
    width: 100%;
    max-width: 780px;
    box-sizing: border-box;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.style.cssText = `
    display: flex;
    border-bottom: 1px solid #e0e0e0;
    background: #fafafa;
  `;
  
  const tabSummary = document.createElement('button');
  tabSummary.textContent = 'AI Summary';
  tabSummary.style.cssText = `
    flex: 1;
    padding: 12px 16px;
    border: none;
    outline: none;
    background: white;
    font-size: 14px;
    font-weight: 600;
    color: #4285F4;
    cursor: pointer;
    transition: all 0.2s ease;
    border-bottom: 3px solid #4285F4;
    font-family: inherit;
  `;
  
  const tabOriginal = document.createElement('button');
  tabOriginal.textContent = 'Original Article';
  tabOriginal.style.cssText = `
    flex: 1;
    padding: 12px 16px;
    border: none;
    outline: none;
    background: #fafafa;
    font-size: 14px;
    font-weight: 600;
    color: #888;
    cursor: pointer;
    transition: all 0.2s ease;
    border-bottom: 3px solid transparent;
    font-family: inherit;
  `;
  
  tabBar.appendChild(tabSummary);
  tabBar.appendChild(tabOriginal);
  
  // Content area
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    padding: 24px;
    min-height: 100px;
  `;
  
  const summaryContent = document.createElement('p');
  summaryContent.style.cssText = `
    font-size: 16px;
    line-height: 1.7;
    color: #333;
    margin: 0;
    font-weight: 400;
  `;
  summaryContent.textContent = summaryText;
  contentArea.appendChild(summaryContent);
  
  panel.appendChild(tabBar);
  panel.appendChild(contentArea);
  
  // Step 4: Insert panel right after h1 itself (before sub-title)
  h1.parentNode.insertBefore(panel, h1.nextSibling);
  
  // Step 5: Hide all siblings after the panel (sub-title, images, etc.)
  const hiddenElements = [];
  let sibling = panel.nextElementSibling;
  while (sibling) {
    const tag = sibling.tagName.toLowerCase();
    if (tag === 'footer' || tag === 'nav') break;
    if (sibling.classList.contains('just-news-summary-panel')) {
      sibling = sibling.nextElementSibling;
      continue;
    }
    hiddenElements.push({ el: sibling, origDisplay: sibling.style.display });
    sibling.style.setProperty('display', 'none', 'important');
    sibling = sibling.nextElementSibling;
  }
  
  // Step 6: If h1's parent is not the articleWrapper, also hide following siblings up the tree
  let ancestor = h1.parentElement;
  while (ancestor && ancestor !== articleWrapper) {
    let ancestorSibling = ancestor.nextElementSibling;
    while (ancestorSibling) {
      const tag = ancestorSibling.tagName.toLowerCase();
      if (tag === 'footer' || tag === 'nav') break;
      hiddenElements.push({ el: ancestorSibling, origDisplay: ancestorSibling.style.display });
      ancestorSibling.style.setProperty('display', 'none', 'important');
      ancestorSibling = ancestorSibling.nextElementSibling;
    }
    ancestor = ancestor.parentElement;
  }
  
  let showingSummary = true;
  
  tabSummary.onclick = () => {
    if (showingSummary) return;
    showingSummary = true;
    tabSummary.style.background = 'white';
    tabSummary.style.color = '#4285F4';
    tabSummary.style.borderBottom = '3px solid #4285F4';
    tabOriginal.style.background = '#fafafa';
    tabOriginal.style.color = '#888';
    tabOriginal.style.borderBottom = '3px solid transparent';
    contentArea.style.display = '';
    hiddenElements.forEach(item => item.el.style.setProperty('display', 'none', 'important'));
  };
  
  tabOriginal.onclick = () => {
    if (!showingSummary) return;
    showingSummary = false;
    tabOriginal.style.background = 'white';
    tabOriginal.style.color = '#4285F4';
    tabOriginal.style.borderBottom = '3px solid #4285F4';
    tabSummary.style.background = '#fafafa';
    tabSummary.style.color = '#888';
    tabSummary.style.borderBottom = '3px solid transparent';
    contentArea.style.display = 'none';
    hiddenElements.forEach(item => item.el.style.display = item.origDisplay || '');
  };
}

// Original function renamed to handle homepage headlines
async function summarizeHomepageHeadlines(isArticle = false) {
  let apiKey = "";
  let apiProvider = "groq";
  let model = "";
  let customPrompt = "";
  let systemPrompt = "";
  let preferedLang = "hebrew";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

- Robotic, factual, no clickbait
- Summarize the key point of the article
- Keep the original language (if Hebrew, give new Hebrew title) and similar length
- Be objective and informative`;

  try {
    const settings = await chrome.storage.sync.get(['apiKey', 'apiProvider', 'model', 'customPrompt', 'systemPrompt', 'preferedLang', 'characterMode']);
    apiKey = settings.apiKey || "";
    apiProvider = settings.apiProvider || "groq";
    model = settings.model || "llama-3.3-70b-versatile";
    customPrompt = settings.customPrompt || defaultPrompt;
    systemPrompt = settings.systemPrompt || defaultSystemPrompt;
    preferedLang = settings.preferedLang || "hebrew";
    var characterMode = settings.characterMode || "robot";
    if (!apiKey) {
      if (!isAutomaticProcessing) {
        await promptForApiKey('Enter key (one-time setup)');
      }
      return;
    }
  } catch (error) {
    if (!isAutomaticProcessing) {
      await createNotification('Error checking API key. Please try again.');
    }
    return;
  }
  const apiOptions = {"apiKey": apiKey, "apiProvider": apiProvider, "model": model, "customPrompt": customPrompt, "systemPrompt": systemPrompt, "preferedLang": preferedLang, "characterMode": characterMode}; 
  
  // Check daily rate limit with background script
  if (!ipb()) {
    const limitCheck = await chrome.runtime.sendMessage({ action: 'checkDailyLimit' });
    if (!limitCheck.canProceed) {
      if (limitCheck.reason === 'dailyLimit' && !isAutomaticProcessing) {
        await createNotification('Daily limit reached. \n\nTo remove the limit, upgrade to premium!');
      }
      return;
    }
  }

  const limit = 20; // Maximum headlines per click
  let firstHeadlineChanged = false;

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
    if (processedElements.has(headline)) return false;
    
    let parent = headline.parentElement;
    while (parent) {
      if (processedElements.has(parent)) return false;
      parent = parent.parentElement;
    }
    
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
    
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
      return false;
    }
    
    return true;
  });

  // Filter out links inside article paragraphs (only when on article page)
  if (isArticle) {
    headlines = headlines.filter(headline => !isInsideArticleParagraph(headline));
  }

  // Filter out subject headlines
  headlines = headlines.filter(headline => {
    const words = headline.textContent.trim().split(/\s+/).filter(w => w.length > 0);
    return words.length > 3;
  });

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
    const articleUrl = headline.href || headline.closest('a')?.href || headline.querySelector('a')?.href;
    if (articleUrl) {
      promises.push(
        (async () => {
          // Check cache first
          const cached = await getCachedHeadline(articleUrl, sourceHeadline, apiOptions);
          if (cached) {
            typeHeadline(headline, `~${cached.newHeadline}`, true);
            if (ipb() && cached.summary) {
              articleSummaries.set(articleUrl, cached.summary);
            }
            counter++;
            return;
          }
          
          // Not in cache - fetch from AI
          const result = await fetchSummary(sourceHeadline, articleUrl, apiOptions);
          const { headline: newHeadline, summary } = parseAIResponse(result);
          
          // Save to cache
          await setCachedHeadline(articleUrl, sourceHeadline, newHeadline, summary, apiOptions);
          
          // Cache the summary for tooltip use
          if (ipb()) {
            articleSummaries.set(articleUrl, summary);
          }

          typeHeadline(headline, `~${newHeadline}`, false);
          counter++;

          // Update daily count with background script
          if (!ipb()) {
            chrome.runtime.sendMessage({ action: 'incrementDailyCount' }, (usage) => {});
          }

          // Notify background to clear badge after first headline changes
          if (!firstHeadlineChanged) {
            firstHeadlineChanged = true;
            chrome.runtime.sendMessage({ action: 'headlineChanged' });
          }
        })()
          .catch(error => {
            if (error.message && error.message.includes('Rate limit')) {
              rateLimitHit = true;
            }
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
  
  // Show Lashon Hara learning suggestion for clean mode users on Hebrew sites
  if (succes.length > 0 && apiOptions.characterMode === 'clean' && window.location.hostname.endsWith('.co.il')) {
    checkAndShowLashonHaraToast();
  }
  
  if (succes.length === 0 && errors.length > 0) {
    // Set rate limit cooldown
    let hasRateLimit = false;
    errors.forEach(e => {
      let msg = e.reason.message || '';
      if (msg.includes('Rate limit') || msg.includes('exceeded')) {
        hasRateLimit = true;
      }
    });
    
    if (hasRateLimit) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
    
    // Don't show error notifications on article pages or during auto-processing
    if (isAutomaticProcessing || isArticle) return;
    
    let minRetryAfter = null;
    hasRateLimit = false;
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
function parseAIResponseOld(result) {
  let newHeadline, summary;
  
  let cleanResult = result.trim();
  if (cleanResult.startsWith('```json')) {
    cleanResult = cleanResult.replace(/```json\s*/, '').replace(/\s*```$/, '');
  }
  if (cleanResult.startsWith('```')) {
    cleanResult = cleanResult.replace(/```\s*/, '').replace(/\s*```$/, '');
  }
  
  try {
    const parsed = JSON.parse(cleanResult);
    newHeadline = parsed.new_headline || parsed.headline || parsed.title;
    summary = parsed.article_summary || parsed.summary || parsed.description;
    
    if (!newHeadline || !summary) {
      throw new Error('Missing required fields in JSON');
    }
    
  } catch (e) {
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
          continue;
        }
      }
    }
    
    if (!jsonFound) {
      throw new Error('Unable to parse AI response - skipping headline');
    }
  }
  
  if (newHeadline.includes('{') || newHeadline.includes('"new_headline"')) {
    throw new Error('Headline appears to be malformed JSON - skipping');
  }
  
  if (typeof newHeadline !== 'string' || newHeadline.trim() === '') {
    throw new Error('Invalid headline format - skipping');
  }
  
  let sanitizedHeadline = newHeadline
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/"/g, "'")
    .replace(/\\/g, '')
    .trim();
  
  if (typeof summary === 'string') {
    summary = summary.replace(/[\r\n]+/g, ' ').trim();
  } else {
    summary = 'Summary unavailable';
  }
  
  return { headline: sanitizedHeadline, summary: summary };
}

function parseAIResponseNew(result){
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
  } catch (e) {}
  
  // Step 2: Clean up markdown and try parsing JSON
  let cleanedText = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .replace(/,\s*}/g, '}')
    .trim();
  
  try {
    const parsed = JSON.parse(cleanedText);
    if (parsed.new_headline || parsed.headline || parsed.title) {
      return {
        headline: (parsed.new_headline || parsed.headline || parsed.title).replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, ''),
        summary: parsed.article_summary || parsed.summary || parsed.description || 'Summary not available'
      };
    }
  } catch (e) {
    let fixedText = cleanedText;
    if (!fixedText.endsWith('}')) {
      if (!fixedText.endsWith('"')) fixedText += '"';
      fixedText += '}';
    }
    
    try {
      const parsed = JSON.parse(fixedText);
      if (parsed.new_headline || parsed.headline || parsed.title) {
        return {
          headline: (parsed.new_headline || parsed.headline || parsed.title).replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, ''),
          summary: parsed.article_summary || parsed.summary || parsed.description || 'Summary not available'
        };
      }
    } catch (e2) {}
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
    } catch (e) {}
  }
  
  // Step 4: Manual text extraction
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

function parseAIResponse(result) {
  try {
    return parseAIResponseOld(result);
  } catch {
    return parseAIResponseNew(result);
  }
}

function extractFirstFieldValue(text, fieldName) {
  const fieldPattern = `"${fieldName}": "`;
  const fieldStart = text.indexOf(fieldPattern);
  if (fieldStart === -1) return null;
  
  const valueStart = fieldStart + fieldPattern.length;
  
  let valueEnd = text.indexOf('", "article_summary"', valueStart);
  if (valueEnd === -1) {
    valueEnd = text.indexOf('",\n  "article_summary"', valueStart);
  }
  if (valueEnd === -1) {
    valueEnd = text.indexOf('"\n}', valueStart);
  }
  if (valueEnd === -1) {
    valueEnd = text.length;
  }
  
  let value = text.substring(valueStart, valueEnd);
  value = value.replace(/\\"/g, '"').replace(/\\/g, '');
  
  return value;
}

function extractSecondFieldValue(text, fieldName) {
  const fieldPattern = `"${fieldName}": "`;
  const fieldStart = text.indexOf(fieldPattern);
  if (fieldStart === -1) return null;
  
  const valueStart = fieldStart + fieldPattern.length;
  
  let valueEnd = text.indexOf('"\n}', valueStart);
  if (valueEnd === -1) {
    valueEnd = text.indexOf('"}', valueStart);
  }
  if (valueEnd === -1) {
    valueEnd = text.length;
  }
  
  let value = text.substring(valueStart, valueEnd);
  value = value.replace(/\\"/g, '"').replace(/\\/g, '');
  
  return value;
}


function typeHeadline(element, text, fromCache = false) {
  element.classList.add('just-news-processed-headline');
  
  let targetElement = element;
  
  const textSpan = element.querySelector('span');
  if (textSpan && textSpan.textContent.trim()) {
    targetElement = textSpan;
  } else {
    const link = element.querySelector('a');
    if (link && link.textContent.trim()) {
      const linkSpan = link.querySelector('span');
      if (linkSpan && linkSpan.textContent.trim()) {
        targetElement = linkSpan;
      } else {
        targetElement = link;
      }
    }
  }
  
  // If from cache, replace immediately without animation
  if (fromCache) {
    targetElement.textContent = text;
    if (ipb()) {
      setupTooltip(element);
    }
    return;
  }
  
  let index = 0;
  targetElement.textContent = '';
  
  if (targetElement._typingInterval) {
    clearInterval(targetElement._typingInterval);
  }
  
  targetElement._typingInterval = setInterval(() => {
    if (!document.body.contains(targetElement)) {
      clearInterval(targetElement._typingInterval);
      targetElement._typingInterval = null;
      return;
    }
    
    if (index < text.length) {
      targetElement.textContent += text[index];
      index++;
    } else {
      clearInterval(targetElement._typingInterval);
      targetElement._typingInterval = null;
      if (ipb()) {
        setupTooltip(element);
      }
    }
  }, 50);
}

// Setup tooltip functionality for a processed headline
function setupTooltip(element) {
  let tooltip = null;
  let tooltipTimeout = null;
  const articleUrl = element.href || element.closest('a')?.href || element.querySelector('a')?.href || window.location.href;
  
  if (!articleUrl) return;
  
  element.addEventListener('mouseenter', () => {
    // Skip tooltip if article summary panel is already on the page
    if (document.querySelector('.just-news-summary-panel')) return;
    
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
    }
    
    tooltipTimeout = setTimeout(() => {
      tooltip = document.createElement('div');
      tooltip.className = 'just-news-tooltip';
      
      if (articleSummaries.has(articleUrl)) {
        const summary = articleSummaries.get(articleUrl);
        tooltip.textContent = summary;
      } else {
        tooltip.textContent = 'Summary unavailable';
      }
      document.body.appendChild(tooltip);
      setTimeout(() => {
        positionTooltip(element, tooltip);
        tooltip.classList.add('show');
      }, 10);
    }, 500);
  });
  
  element.addEventListener('mouseleave', () => {
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

// Position tooltip relative to the element
function positionTooltip(element, tooltip) {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let x = rect.left + (rect.width / 2);
  let y = rect.bottom + 10;
  
  const tooltipWidth = 350;
  const tooltipHeight = 100;
  
  x = x - (tooltipWidth / 2);
  
  if (x + tooltipWidth > viewportWidth - 10) {
    x = viewportWidth - tooltipWidth - 10;
  }
  if (x < 10) {
    x = 10;
  }
  
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
  const { apiKey, apiProvider, model, customPrompt, systemPrompt, preferedLang, characterMode } = options;
  
  const summaryInstruction = characterMode === 'clean'
    ? '<2-3 sentence summary of the article that follows the same clean speech rules - no names, no negativity, no inappropriate content, but still informative with key facts>'
    : '<2-3 sentence objective summary of the article>';
  
  const systemInstructions = `

Original: ${sourceHeadline}
Article: ${content}

IMPORTANT: You must return your response in this exact JSON format:
{"new_headline": "<your rewritten headline>", "article_summary": "${summaryInstruction}"}

Do not add any text before or after the JSON. Only return the JSON object.`;

  let prompt = customPrompt;
  if (preferedLang != 'english') {
    prompt += `(if content in ${preferedLang} generate ${preferedLang} headline).`;
  } 
  prompt += systemInstructions;
  const response = await chrome.runtime.sendMessage({
    action: 'AIcall',
    sourceHeadline,
    prompt,
    apiKey,
    model,
    systemPrompt,
    apiProvider
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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    backdrop-filter: blur(3px);
    direction: ltr;
  `;

  const promptBox = document.createElement('div');
  promptBox.style.cssText = `
    background: white;
    padding: 32px 28px;
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
    width: 90%;
    max-width: 480px;
    box-sizing: border-box;
    animation: slideIn 0.3s ease;
    max-height: 90vh;
    overflow-y: auto;
    direction: ltr;
    text-align: left;
  `;

  const stepIndicator = document.createElement('div');
  stepIndicator.style.cssText = `
    text-align: center;
    font-size: 12px;
    color: #888;
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  `;
  stepIndicator.textContent = 'STEP 1 OF 2';

  const title = document.createElement('h3');
  title.textContent = 'Connect Your AI Provider';
  title.style.cssText = `
    text-align: center;
    font-size: 18px;
    color: #333;
    font-weight: 700;
    margin-bottom: 16px;
    line-height: 1.3;
  `;

  const stepsContainer = document.createElement('div');
  stepsContainer.style.cssText = `
    margin-bottom: 24px;
    padding: 16px;
    background: #f8f9fa;
    border-radius: 8px;
    border-left: 4px solid #4285F4;
    direction: ltr;
  `;

  const step1 = document.createElement('a');
  step1.href = 'https://console.groq.com/';
  step1.target = '_blank';
  step1.style.cssText = `
    display: flex;
    align-items: start;
    font-size: 14px;
    color: #333;
    direction: ltr;
    text-decoration: none;
    margin-bottom: 12px;
    padding: 12px;
    border-radius: 8px;
    transition: all 0.2s ease;
    cursor: pointer;
    background: rgba(66, 133, 244, 0.05);
    border: 2px solid rgba(66, 133, 244, 0.2);
    box-shadow: 0 2px 4px rgba(66, 133, 244, 0.1);
  `;
  
  step1.innerHTML = `
    <span style="background: #4285F4; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; margin-right: 12px; flex-shrink: 0; box-shadow: 0 2px 4px rgba(66, 133, 244, 0.3);">1</span>
    <div style="flex: 1;">
      <div style="font-weight: 600; color: #4285F4; margin-bottom: 2px;">Sign up to Groq AI</div>
      <div style="font-size: 12px; color: #666;">Create your free account &bull; Click to open</div>
    </div>
    <span style="color: #4285F4; font-size: 16px; margin-left: 8px;">&rarr;</span>
  `;

  step1.onmouseover = () => {
    step1.style.background = 'rgba(66, 133, 244, 0.1)';
    step1.style.borderColor = '#4285F4';
    step1.style.transform = 'translateY(-2px)';
    step1.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.2)';
  };
  step1.onmouseout = () => {
    step1.style.background = 'rgba(66, 133, 244, 0.05)';
    step1.style.borderColor = 'rgba(66, 133, 244, 0.2)';
    step1.style.transform = 'translateY(0)';
    step1.style.boxShadow = '0 2px 4px rgba(66, 133, 244, 0.1)';
  };

  const step2 = document.createElement('a');
  step2.href = 'https://console.groq.com/keys';
  step2.target = '_blank';
  step2.style.cssText = `
    display: flex;
    align-items: start;
    font-size: 14px;
    color: #333;
    direction: ltr;
    text-decoration: none;
    margin-bottom: 12px;
    padding: 12px;
    border-radius: 8px;
    transition: all 0.2s ease;
    cursor: pointer;
    background: rgba(66, 133, 244, 0.05);
    border: 2px solid rgba(66, 133, 244, 0.2);
    box-shadow: 0 2px 4px rgba(66, 133, 244, 0.1);
  `;
  
  step2.innerHTML = `
    <span style="background: #4285F4; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; margin-right: 12px; flex-shrink: 0; box-shadow: 0 2px 4px rgba(66, 133, 244, 0.3);">2</span>
    <div style="flex: 1;">
      <div style="font-weight: 600; color: #4285F4; margin-bottom: 2px;">Generate your key</div>
      <div style="font-size: 12px; color: #666;">Create your API key &bull; Click to open</div>
    </div>
    <span style="color: #4285F4; font-size: 16px; margin-left: 8px;">&rarr;</span>
  `;

  step2.onmouseover = () => {
    step2.style.background = 'rgba(66, 133, 244, 0.1)';
    step2.style.borderColor = '#4285F4';
    step2.style.transform = 'translateY(-2px)';
    step2.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.2)';
  };
  step2.onmouseout = () => {
    step2.style.background = 'rgba(66, 133, 244, 0.05)';
    step2.style.borderColor = 'rgba(66, 133, 244, 0.2)';
    step2.style.transform = 'translateY(0)';
    step2.style.boxShadow = '0 2px 4px rgba(66, 133, 244, 0.1)';
  };

  stepsContainer.appendChild(step1);
  stepsContainer.appendChild(step2);
  
  const inputLabel = document.createElement('label');
  inputLabel.textContent = 'Paste your key here:';
  inputLabel.style.cssText = `
    display: block;
    font-size: 14px;
    color: #333;
    font-weight: 600;
    margin-bottom: 8px;
    direction: ltr;
    text-align: left;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentKey;
  input.placeholder = 'gsk...';
  input.style.cssText = `
    width: 100%;
    padding: 12px;
    margin-bottom: 8px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    box-sizing: border-box;
    font-size: 14px;
    transition: all 0.2s ease;
    outline: none;
    font-family: monospace;
    direction: ltr;
    text-align: left;
  `;

  const helpText = document.createElement('p');
  helpText.textContent = 'Your key is safe and stored locally';
  helpText.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 20px;
    text-align: center;
    font-style: italic;
  `;

  input.onfocus = () => {
    input.style.borderColor = '#4285F4';
    input.style.boxShadow = '0 0 0 2px rgba(66, 133, 244, 0.1)';
  };
  input.onblur = () => {
    input.style.borderColor = '#e0e0e0';
    input.style.boxShadow = 'none';
  };

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
  `;

  const submitButton = document.createElement('button');
  submitButton.textContent = 'Save';
  submitButton.style.cssText = `
    background: #4285F4;
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  submitButton.onmouseover = () => {
    submitButton.style.background = '#1a73e8';
    submitButton.style.transform = 'translateY(-1px)';
  };
  submitButton.onmouseout = () => {
    submitButton.style.background = '#4285F4';
    submitButton.style.transform = 'translateY(0)';
  };

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';
  cancelButton.style.cssText = `
    background: transparent;
    color: #666;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  cancelButton.onmouseover = () => {
    cancelButton.style.background = '#f5f5f5';
    cancelButton.style.transform = 'translateY(-1px)';
  };
  cancelButton.onmouseout = () => {
    cancelButton.style.background = 'transparent';
    cancelButton.style.transform = 'translateY(0)';
  };

  buttonContainer.appendChild(submitButton);
  buttonContainer.appendChild(cancelButton);
  
  promptBox.appendChild(stepIndicator);
  promptBox.appendChild(title);
  promptBox.appendChild(stepsContainer);
  promptBox.appendChild(inputLabel);
  promptBox.appendChild(input);
  promptBox.appendChild(helpText);
  promptBox.appendChild(buttonContainer);
  overlay.appendChild(promptBox);

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  return { overlay, input, submitButton, cancelButton };
}

// Check if we should show Lashon Hara learning toast (once ever)
async function checkAndShowLashonHaraToast() {
  try {
    const { lashonHaraToastShown, cleanModeUseCount } = await chrome.storage.local.get(['lashonHaraToastShown', 'cleanModeUseCount']);
    if (lashonHaraToastShown) return;
    
    const newCount = (cleanModeUseCount || 0) + 1;
    await chrome.storage.local.set({ cleanModeUseCount: newCount });
    
    if (newCount >= 3) {
      await chrome.storage.local.set({ lashonHaraToastShown: true });
      showLashonHaraToast();
    }
  } catch (error) {
    // Silently ignore
  }
}

function showLashonHaraToast() {
  const host = document.createElement('div');
  host.style.cssText = `
    position: fixed !important;
    top: 4px !important;
    right: 20px !important;
    z-index: 2147483646 !important;
    pointer-events: auto !important;
  `;
  
  const toast = document.createElement('div');
  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    background: white;
    color: #333;
    padding: 12px 16px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.3s ease;
    border-left: 4px solid #4285F4;
    max-width: 380px;
    direction: rtl;
  `;
  
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/icon48.png');
  icon.style.cssText = 'width: 24px; height: 24px; border-radius: 4px;';
  
  const text = document.createElement('span');
  text.style.cssText = 'flex: 1; line-height: 1.6;';
  text.innerHTML = '\u05E8\u05D5\u05E6\u05D4 \u05DC\u05D4\u05E8\u05D7\u05D9\u05D1 \u05D0\u05EA \u05D4\u05D9\u05D3\u05E2 \u05E9\u05DC\u05DA \u05D1\u05D4\u05DC\u05DB\u05D5\u05EA \u05DC\u05E9\u05D5\u05DF \u05D4\u05E8\u05E2 \u05D5\u05E8\u05DB\u05D9\u05DC\u05D5\u05EA? \u05D9\u05DB\u05D5\u05DC \u05DC\u05E2\u05D9\u05D9\u05DF <a href="https://www.makorrishon.co.il/lashon" target="_blank" style="color: #4285F4; text-decoration: underline;">\u05DB\u05D0\u05DF</a>';
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: #999;
    font-size: 18px;
    cursor: pointer;
    padding: 0 0 0 8px;
    line-height: 1;
  `;
  closeBtn.onmouseover = () => closeBtn.style.color = '#666';
  closeBtn.onmouseout = () => closeBtn.style.color = '#999';
  
  toast.appendChild(closeBtn);
  toast.appendChild(text);
  toast.appendChild(icon);
  host.appendChild(toast);
  document.body.appendChild(host);
  
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 100);
  
  const autoHideTimeout = setTimeout(() => {
    hideToast();
  }, 10000);
  
  closeBtn.onclick = () => {
    clearTimeout(autoHideTimeout);
    hideToast();
  };
  
  function hideToast() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      host.remove();
    }, 300);
  }
}

// Check if we should show the reminder toast (once per day)
async function checkAndShowReminderToast() {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  
  try {
    const { lastReminderToastShown } = await chrome.storage.local.get('lastReminderToastShown');
    const now = Date.now();
    
    if (!lastReminderToastShown || (now - lastReminderToastShown) > ONE_DAY_MS) {
      await chrome.storage.local.set({ lastReminderToastShown: now });
      showReminderToast();
    }
  } catch (error) {
    showReminderToast();
  }
}

// Show a small, non-intrusive toast reminder
function showReminderToast() {
  const host = document.createElement('div');
  host.className = 'just-news-toast-host';
  host.style.cssText = `
    position: fixed !important;
    top: 4px !important;
    right: 20px !important;
    z-index: 2147483646 !important;
    pointer-events: auto !important;
  `;
  
  const toast = document.createElement('div');
  toast.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    background: white;
    color: #333;
    padding: 12px 16px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    opacity: 0;
    transform: translateY(-20px);
    transition: all 0.3s ease;
    border-left: 4px solid #4285F4;
    max-width: 300px;
  `;
  
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/icon48.png');
  icon.style.cssText = 'width: 24px; height: 24px; border-radius: 4px;';
  
  const text = document.createElement('span');
  text.textContent = 'Click the Just News icon to transform headlines';
  text.style.cssText = 'flex: 1; line-height: 1.4;';
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    background: none;
    border: none;
    color: #999;
    font-size: 18px;
    cursor: pointer;
    padding: 0 0 0 8px;
    line-height: 1;
  `;
  closeBtn.onmouseover = () => closeBtn.style.color = '#666';
  closeBtn.onmouseout = () => closeBtn.style.color = '#999';
  
  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(closeBtn);
  host.appendChild(toast);
  document.body.appendChild(host);
  
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 100);
  
  const autoHideTimeout = setTimeout(() => {
    hideToast();
  }, 6000);
  
  closeBtn.onclick = () => {
    clearTimeout(autoHideTimeout);
    hideToast();
  };
  
  function hideToast() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      host.remove();
    }, 300);
  }
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

  if (message === "Daily limit reached. \n\nTo remove the limit, upgrade to premium!") {
    const upgradeButton = document.createElement('a');
    upgradeButton.href = 'https://tsurdan.github.io/Just-News/premium.html';
    upgradeButton.target = '_blank';
    upgradeButton.style.cssText = `
      position: relative;
      padding: 2px;
      border-radius: 30px;
      background: linear-gradient(135deg, #8A2BE2 0%, #58CC02 25%, #6200EE 50%, #58CC02 75%, #8A2BE2 100%);
      background-size: 300% 300%;
      animation: gradientShift 8s linear infinite;
      text-decoration: none;
      cursor: pointer;
      direction: ltr;
    `;

    const upgradeSpan = document.createElement('span');
    upgradeSpan.textContent = 'Upgrade to Premium';
    upgradeSpan.style.cssText = `
      display: block;
      background: transparent;
      color: white;
      padding: 10px 20px;
      border-radius: 28px;
      font-size: 14px;
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
    buttonContainer.appendChild(upgradeButton);
  }

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

async function promptForApiKey(message, currentKey = '') {
  return new Promise((resolve, reject) => {
    const { overlay, input, submitButton, cancelButton } = createApiKeyPrompt(message, currentKey);
    document.body.appendChild(overlay);

    submitButton.onclick = async () => {
      const apiKey = input.value.trim();
      if (apiKey) {
        await chrome.storage.sync.set({ apiKey });
        // Show step 2: mode selection
        showModeSelectionStep(overlay, () => {
          summarizeHeadlines();
          resolve(apiKey);
        });
      } else {
        input.style.border = '1px solid red';
      }
    };

    cancelButton.onclick = () => {
      try {
        document.body.removeChild(overlay);
      } catch (error) {}
      resolve(null);
    };
  });
}

// Step 2: Mode selection after API key is saved
function showModeSelectionStep(overlay, onComplete) {
  // Clear the overlay content - find the direct child promptBox
  const promptBox = overlay.firstElementChild;
  if (!promptBox) return;
  promptBox.innerHTML = '';
  promptBox.style.animation = 'slideIn 0.3s ease';
  promptBox.style.maxWidth = '480px';

  const stepIndicator = document.createElement('div');
  stepIndicator.style.cssText = `
    text-align: center;
    font-size: 12px;
    color: #888;
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  `;
  stepIndicator.textContent = 'STEP 2 OF 2';

  const title = document.createElement('h3');
  title.textContent = 'Choose Your Mode';
  title.style.cssText = `
    text-align: center;
    font-size: 18px;
    color: #333;
    font-weight: 700;
    margin-bottom: 8px;
    line-height: 1.3;
  `;

  const subtitle = document.createElement('p');
  subtitle.textContent = 'How should your headlines be rewritten?';
  subtitle.style.cssText = `
    text-align: center;
    font-size: 13px;
    color: #666;
    margin-bottom: 20px;
  `;

  const modesContainer = document.createElement('div');
  modesContainer.style.cssText = `
    display: flex;
    gap: 16px;
    justify-content: center;
    margin-bottom: 20px;
  `;

  const modes = [
    { id: 'robot', name: 'Robot', desc: 'Factual & objective', icon: 'robot' },
    { id: 'clean', name: 'Clean', desc: 'Family-friendly & ethical', icon: 'clean' }
  ];

  let selectedMode = 'robot';

  modes.forEach(mode => {
    const modeCard = document.createElement('div');
    modeCard.style.cssText = `
      flex: 1;
      max-width: 180px;
      padding: 20px 16px;
      border-radius: 12px;
      border: 2px solid ${mode.id === 'robot' ? '#4285F4' : '#e0e0e0'};
      background: ${mode.id === 'robot' ? '#f0f4ff' : 'white'};
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: center;
      box-shadow: ${mode.id === 'robot' ? '0 4px 12px rgba(66, 133, 244, 0.2)' : '0 2px 8px rgba(0,0,0,0.05)'};
    `;

    const iconImg = document.createElement('img');
    iconImg.src = chrome.runtime.getURL('more-icons/' + mode.icon + '.png');
    iconImg.style.cssText = 'width: 44px; height: 44px; margin: 0 auto 8px auto; display: block;';
    iconImg.alt = mode.name;
    iconImg.onerror = () => { iconImg.style.display = 'none'; };
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: 600; font-size: 15px; color: #333; margin-bottom: 4px;';
    nameDiv.textContent = mode.name;
    const descDiv = document.createElement('div');
    descDiv.style.cssText = 'font-size: 12px; color: #666;';
    descDiv.textContent = mode.desc;
    modeCard.appendChild(iconImg);
    modeCard.appendChild(nameDiv);
    modeCard.appendChild(descDiv);

    modeCard.onmouseover = () => {
      if (selectedMode !== mode.id) {
        modeCard.style.borderColor = '#4285F4';
        modeCard.style.transform = 'translateY(-2px)';
      }
    };
    modeCard.onmouseout = () => {
      if (selectedMode !== mode.id) {
        modeCard.style.borderColor = '#e0e0e0';
        modeCard.style.transform = 'translateY(0)';
      }
    };

    modeCard.onclick = () => {
      selectedMode = mode.id;
      // Update all cards
      modesContainer.querySelectorAll('div[data-mode]').forEach(card => {
        card.style.borderColor = '#e0e0e0';
        card.style.background = 'white';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
      });
      modeCard.style.borderColor = '#4285F4';
      modeCard.style.background = '#f0f4ff';
      modeCard.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.2)';
    };

    modeCard.setAttribute('data-mode', mode.id);
    modesContainer.appendChild(modeCard);
  });

  const premiumHint = document.createElement('p');
  premiumHint.innerHTML = 'More modes available with <a href="https://tsurdan.github.io/Just-News/premium.html" target="_blank" style="color: #58CC02; font-weight: 600; text-decoration: none;">Premium</a>';
  premiumHint.style.cssText = `
    text-align: center;
    font-size: 12px;
    color: #888;
    margin-bottom: 20px;
  `;

  const doneButton = document.createElement('button');
  doneButton.textContent = "Let's Go!";
  doneButton.style.cssText = `
    display: block;
    width: 100%;
    background: #4285F4;
    color: white;
    border: none;
    padding: 14px 24px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  `;

  doneButton.onmouseover = () => {
    doneButton.style.background = '#1a73e8';
    doneButton.style.transform = 'translateY(-1px)';
    doneButton.style.boxShadow = '0 4px 12px rgba(66, 133, 244, 0.3)';
  };
  doneButton.onmouseout = () => {
    doneButton.style.background = '#4285F4';
    doneButton.style.transform = 'translateY(0)';
    doneButton.style.boxShadow = 'none';
  };

  doneButton.onclick = async () => {
    // Save mode and its corresponding prompts
    const modePrompts = {
      robot: {
        systemPrompt: "Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.",
        customPrompt: "Rewrite the headline, based on the article, with these rules:\n\n- Robotic, factual, no clickbait\n- Summarize the key point of the article\n- Be objective and informative\n Keep the original headline length and language"
      },
      clean: {
        systemPrompt: "You are a guardian of ethical and family-friendly speech according to Jewish laws of Lashon Hara (evil speech). You rewrite headlines to remove gossip, slander, negativity about individuals, harmful speech, profanity, swear words, violence, sexual content, and any content inappropriate for all ages. Focus on constructive, respectful, and clean language that avoids speaking negatively about people. Even don't write any name of person, just generalize it. Still make the headline informative and summarizing the main point of the article and facts, informative no clickbate, while adhering to these ethical guidelines.",
        customPrompt: "Rewrite this headline according to Jewish laws against Lashon Hara (evil speech) and remove all inappropriate content. Remove:\n- Gossip, slander, or negative speech about individuals\n- Profanity and swear words\n- Violent or graphic descriptions\n- Sexual content or references\n- Any content not suitable for all ages\n\nFocus only on essential facts presented respectfully and appropriately, informative no clickbate. If the article contains only inappropriate content with no constructive value, note that it violates speech ethics.\n\nYour answer must be in the original headline length and in the article language."
      }
    };
    const prompts = modePrompts[selectedMode] || modePrompts.robot;
    await chrome.storage.sync.set({
      characterMode: selectedMode,
      systemPrompt: prompts.systemPrompt,
      customPrompt: prompts.customPrompt
    });
    try {
      overlay.remove();
    } catch (e) {}
    onComplete();
  };

  promptBox.appendChild(stepIndicator);
  promptBox.appendChild(title);
  promptBox.appendChild(subtitle);
  promptBox.appendChild(modesContainer);
  promptBox.appendChild(premiumHint);
  promptBox.appendChild(doneButton);
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

// Initialize cache cleanup on startup
cleanupCacheIfNeeded().catch(err => console.error('Initial cache cleanup failed:', err));

initializeContentScript();
