// TODO: Fix too many api requests even without activity
// TODO: Chang model to llama-3.1-8b-instant and test
// TODO: Check upgrade-to-premium spamming
// TODO: Optimize clean mode
// TODO: In Article Summary?
// TODO: compatibility to past in-local-storage premium users
// TODO: Maybe cache mechanism in server also?
// TODO: More usage limits on free users
// TODO: Make the working with server generic to other future extensions too
// TODO: Legal: update privacy policy and make legal research
// TODO: Update firefox code also
// TODO: Update texts
// TODO: Prod

// Cache configuration
const CACHE_PREFIX = 'justnews_cache_';
const CACHE_TTL_DAYS = 1; // Cache expires after 1 day
const MAX_CACHE_ENTRIES = 500; // Limit cache size to prevent storage bloat
const CACHE_VERSION = 'v1'; // Increment to invalidate old cache format
const MAX_CACHE_ENTRY_SIZE = 3000; // Max bytes per cache entry

let autoReplaceHeadlines = true; // Default: enabled
let isInitialized = false;
let counter = 0;
let articleSummaries = new Map(); // Cache for article summaries
let isLoginPromptShown = false; // Prevent duplicate login prompts
let userSelectedElement = null; // Store user's selected headline element
let lastScrollY = 0; // Track scroll position for dynamic processing
let scrollProcessingTimeout = null; // Debounce scroll processing
let isAutomaticProcessing = false; // Flag to suppress notifications during automatic scroll processing

// ============= CACHE UTILITIES =============

/**
 * Generate cache key from URL, headline, and API options
 * @param {string} url - Article URL
 * @param {string} headline - Original headline text
 * @param {Object} apiOptions - API options (mode, prompts, language)
 * @returns {string} Cache key
 */
function generateCacheKey(url, headline, apiOptions = {}) {
  // Use URL + headline + settings hash for uniqueness
  // Different mode or prompts = different cache entry
  const normalizedUrl = url.split('?')[0].split('#')[0]; // Remove query params and hash
  const headlineHash = simpleHash(headline.trim().toLowerCase());
  
  // Include mode, prompts, and language in cache key
  const settingsString = JSON.stringify({
    mode: apiOptions.mode || 'robot',
    customPrompt: apiOptions.customPrompt || '',
    systemPrompt: apiOptions.systemPrompt || '',
    preferedLang: apiOptions.preferedLang || 'english'
  });
  const settingsHash = simpleHash(settingsString);
  
  return `${CACHE_PREFIX}${CACHE_VERSION}_${normalizedUrl}_${headlineHash}_${settingsHash}`;
}

/**
 * Simple hash function for creating cache keys
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Get cached headline result
 * @param {string} url - Article URL
 * @param {string} originalHeadline - Original headline text
 * @param {Object} apiOptions - API options to match against cache
 * @returns {Promise<Object|null>} Cached result or null if not found/expired
 */
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
    
    // Check if cache is expired
    if (age > maxAge) {
      // Remove expired entry
      await chrome.storage.local.remove(cacheKey);
      return null;
    }
    
    return cached;
  } catch (error) {
    console.error('Error reading cache:', error);
    return null;
  }
}

/**
 * Save headline result to cache
 * @param {string} url - Article URL
 * @param {string} originalHeadline - Original headline text
 * @param {string} newHeadline - AI-generated headline
 * @param {string} summary - Article summary (for premium users)
 * @param {Object} apiOptions - API options used to generate this headline
 */
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
    
    // Calculate approximate size (rough estimate in bytes)
    const approximateSize = JSON.stringify(cacheData).length;
    
    // Only cache if size is reasonable - skip oversized entries
    if (approximateSize > MAX_CACHE_ENTRY_SIZE) {
      console.warn('Cache entry too large, skipping:', approximateSize, 'bytes');
      return;
    }
    
    await chrome.storage.local.set({ [cacheKey]: cacheData });
    
    // Cleanup old entries if cache is getting too large
    await cleanupCacheIfNeeded();
  } catch (error) {
    console.error('Error writing cache:', error);
  }
}

/**
 * Clean up expired cache entries and enforce size limits
 */
async function cleanupCacheIfNeeded() {
  try {
    // Get all storage keys
    const allData = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(allData).filter(key => key.startsWith(CACHE_PREFIX));
    
    // If under limit, no cleanup needed
    if (cacheKeys.length < MAX_CACHE_ENTRIES) {
      return;
    }
    
    const now = Date.now();
    const maxAge = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    const entriesToRemove = [];
    const validEntries = [];
    
    // Separate expired and valid entries
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
    
    // If still over limit after removing expired, remove oldest entries
    if (validEntries.length > MAX_CACHE_ENTRIES) {
      validEntries.sort((a, b) => a.timestamp - b.timestamp); // Sort by oldest first
      const toRemove = validEntries.length - MAX_CACHE_ENTRIES;
      for (let i = 0; i < toRemove; i++) {
        entriesToRemove.push(validEntries[i].key);
      }
    }
    
    // Remove entries in batch
    if (entriesToRemove.length > 0) {
      await chrome.storage.local.remove(entriesToRemove);
      console.log(`Cache cleanup: removed ${entriesToRemove.length} entries`);
    }
  } catch (error) {
    console.error('Error during cache cleanup:', error);
  }
}

// ============= END CACHE UTILITIES =============

// Detect if we're on an article page (simplified - just checks if there's a main article to process)
function isArticlePage() {
  const h1Tags = document.querySelectorAll('h1');
  const paragraphs = document.querySelectorAll('p');
  
  // Must have exactly one H1 (main article headline)
  if (h1Tags.length !== 1) {
    return false;
  }
  
  // Must have substantial content (at least 3 paragraphs)
  if (paragraphs.length < 3) {
    return false;
  }
  
  // Calculate total paragraph text length
  const paragraphText = Array.from(paragraphs)
    .map(p => p.textContent.trim())
    .join(' ');
  
  // Must have substantial content (at least 500 characters)
  if (paragraphText.length < 500) {
    return false;
  }
  
  // Passed all checks - this is an article page with a main headline to process
  return true;
}

// Extract article headline from article page
function extractArticleHeadline() {
  // Try multiple selectors in order of preference
  const selectors = [
    'h1[itemprop="headline"]',
    'h1.article-title',
    'h1.entry-title',
    'h1.post-title',
    'article h1',
    '[role="article"] h1',
    '.article-header h1',
    '.post-header h1',
    'h1', // Fallback to first h1
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

// Extract article content from article page (reuse existing logic)
function extractArticleContent() {
  // Try to find article container
  const articleSelectors = [
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
  
  // If no article container found, use body
  if (!articleContainer) {
    articleContainer = document.body;
  }
  
  // Remove unwanted elements
  const unwantedSelectors = [
    'script', 'style', 'nav', 'header', 'footer', 
    'aside', '.sidebar', '.advertisement', '.ad', 
    '.comments', '.related-articles'
  ];
  
  const clone = articleContainer.cloneNode(true);
  unwantedSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  // Extract text from paragraphs
  const paragraphs = Array.from(clone.querySelectorAll('p'));
  let content = paragraphs.map(p => p.textContent.trim()).filter(t => t.length > 0).join(' ');
  
  // If not enough content, try other elements
  if (!content || content.length < 100) {
    const textElements = Array.from(clone.querySelectorAll('div, span'));
    content = textElements
      .map(el => el.textContent.trim())
      .filter(t => t.length > 50)
      .join(' ');
  }
  
  return content;
}

// Helper function to check if a headline is inside article paragraph content
function isInsideArticleParagraph(headline) {
  // Check if this element or any of its ancestors is a <p> tag or inside a <p> tag
  let element = headline;
  
  // First check the element itself
  if (element.tagName === 'P') {
    return true;
  }
  
  // Then check all parent elements up the tree
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    if (parent.tagName === 'P') {
      // This element is inside a paragraph - it's inline article content
      return true;
    }
    parent = parent.parentElement;
  }
  
  return false;
}

// Helper function to check if user has premium from JWT (via background script)
async function isPremiumUser() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkPremiumStatus' });
    return response?.isPremium || false;
  } catch (e) {
    return false;
  }
}

// Setup scroll listener to process headlines as user scrolls
function setupScrollListener() {
  let isProcessing = false;

  window.addEventListener('scroll', () => {
    // Check if auto-replace is still enabled
    if (!autoReplaceHeadlines || isProcessing) return;

    const currentScrollY = window.scrollY;
    const scrollDifference = Math.abs(currentScrollY - lastScrollY);

    // Only process if scrolled more than 300px (significant scroll)
    if (scrollDifference > 300) {
      // Debounce: wait for scrolling to settle
      clearTimeout(scrollProcessingTimeout);
      scrollProcessingTimeout = setTimeout(async () => {
        isProcessing = true;
        isAutomaticProcessing = true; // Enable silent mode
        lastScrollY = currentScrollY;
        
        // Re-run headline processing (will skip already processed headlines with ~)
        counter = 0; // Reset counter to process from the beginning
        await summarizeHeadlines();
        
        isAutomaticProcessing = false; // Disable silent mode
        isProcessing = false;
      }, 500); // Wait 500ms after scrolling stops
    }
  }, { passive: true });

  // Also handle dynamically added content
  const mutationObserver = new MutationObserver(() => {
    if (!autoReplaceHeadlines || isProcessing) return;
    
    clearTimeout(scrollProcessingTimeout);
    scrollProcessingTimeout = setTimeout(async () => {
      isProcessing = true;
      isAutomaticProcessing = true; // Enable silent mode
      counter = 0;
      await summarizeHeadlines();
      isAutomaticProcessing = false; // Disable silent mode
      isProcessing = false;
    }, 1000); // Wait longer for DOM changes to settle
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

async function initializeContentScript() {
  if (isInitialized) return;

  // Load autoReplaceHeadlines setting from storage (default true)
  chrome.storage.sync.get(['autoReplaceHeadlines'], (data) => {
    if (typeof data.autoReplaceHeadlines === 'boolean') {
      autoReplaceHeadlines = data.autoReplaceHeadlines;
    } else {
      autoReplaceHeadlines = true;
    }

    // If enabled, run headline replacement automatically
    if (autoReplaceHeadlines) {
      // Wait for DOM to be ready and content to render
      if (document.readyState === 'loading') {
        // DOM is still loading
        document.addEventListener('DOMContentLoaded', () => {
          // Give a small delay for dynamic content to render
          setTimeout(() => {
            summarizeHeadlines();
          }, 500);
        });
      } else {
        // DOM is already loaded (interactive or complete)
        // Give a small delay for dynamic content to render
        setTimeout(() => {
          summarizeHeadlines();
        }, 500);
      }
      // Set up scroll listener for dynamic headline processing
      setupScrollListener();
    }
  });

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
    /* Targeted reset for Just News popups to prevent website CSS interference */
    .just-news-popup-reset {
      all: unset !important;
    }
    
    .just-news-popup-reset * {
      font-family: inherit !important;
      box-sizing: border-box !important;
    }
    
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
  // Check if this is an article page first
  const isArticle = isArticlePage();
  
  // STEP 1: Always process linked headlines (homepage-style processing)
  // This catches related articles, navigation links, etc.
  try {
      await summarizeHomepageHeadlines(isArticle);
  } catch (error) {
      console.log('Error processing headlines: ' + error.message);
  }
  
  // STEP 2: Additionally check if this is an article page and process the main headline
  if (isArticle) {
    // Also replace the main article headline (non-linked h1)
    await summarizeArticleHeadline();
  }
}

// New function to handle article page headline replacement
async function summarizeArticleHeadline() {
  let model = "";
  let customPrompt = "";
  let systemPrompt = "";
  let preferedLang = "english";
  let mode = "";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

- Robotic, factual, no clickbait
- Summarize the key point of the article
- Keep the original language (if Hebrew, give new Hebrew title) and similar length
- Be objective and informative`;

  try {
    const settings = await chrome.storage.sync.get(['characterMode', 'customPrompt', 'systemPrompt', 'preferedLang']);
    customPrompt = settings.customPrompt || defaultPrompt;
    systemPrompt = settings.systemPrompt || defaultSystemPrompt;
    preferedLang = settings.preferedLang || preferedLang;
    mode = settings.characterMode || 'robot';
  } catch (error) {
    if (!isAutomaticProcessing) {
      await createNotification('Error loading settings. Please try again.');
    }
    return;
  }
  
  const apiOptions = {"customPrompt": customPrompt, "systemPrompt": systemPrompt, "preferedLang": preferedLang, "mode": mode};
  
  // Extract article headline and content
  const headlineData = extractArticleHeadline();
  if (!headlineData) {
    if (!isAutomaticProcessing) {
      await createNotification('Could not find article headline on this page.');
    }
    return;
  }
  if (headlineData.text.startsWith('~')) {
    // Already processed
    return;
  }
  
  const content = extractArticleContent();
  if (!content || content.length < 100) {
    if (!isAutomaticProcessing) {
      await createNotification('Could not extract article content from this page.');
    }
    return;
  }
  
  const sourceHeadline = headlineData.text;
  const headlineElement = headlineData.element;
  const articleUrl = window.location.href;
  
  // Check premium status
  const hasPremium = await isPremiumUser();
  
  // Check cache first
  const cached = await getCachedHeadline(articleUrl, sourceHeadline, apiOptions);
  if (cached) {
    // Use cached result - instant replacement, no animation
    typeHeadline(headlineElement, `~${cached.newHeadline}`, hasPremium, true);
    
    // Cache the summary for tooltip if premium user
    if (hasPremium && cached.summary) {
      articleSummaries.set(articleUrl, cached.summary);
    }
    
    // Clear badge
    chrome.runtime.sendMessage({ action: 'headlineChanged' });
    return;
  }
  
  try {
    // Call AI to get new headline (pass content directly instead of URL)
    const summary = await summarizeContentDirectly(
      sourceHeadline,
      content,
      apiOptions
    );
    
    // Parse the AI response
    const { headline: newHeadline, summary: articleSummary } = parseAIResponse(summary, hasPremium);
    
    // Save to cache
    await setCachedHeadline(articleUrl, sourceHeadline, newHeadline, articleSummary, apiOptions);
    
    // Replace the headline with typing effect
    typeHeadline(headlineElement, `~${newHeadline}`, hasPremium, false);
    
    // Cache the summary if premium user
    if (hasPremium && articleSummary) {
      articleSummaries.set(articleUrl, articleSummary);
    }
    
    // Clear badge
    chrome.runtime.sendMessage({ action: 'headlineChanged' });
    
  } catch (error) {
    // Always show daily rate limits, premium, and login prompts even in automatic mode
    if (error.message && (error.message.includes('Daily limit exceeded') || error.message.includes('Daily token limit exceeded'))) {
      await createNotification(error.message);
      return;
    }
    
    if (error.message && error.message.includes('Daily quota exceeded')) {
      await createPremiumNotification('Daily limit exceeded. Please upgrade to premium for more usage.');
      return;
    }
    
    if (error.message && error.message.includes('Session expired')) {
      if (!isLoginPromptShown) {
        isLoginPromptShown = true;
        showLoginPrompt();
      }
      return;
    }
    
    // Silently skip other errors during automatic processing (including minute-based rate limits)
    if (isAutomaticProcessing) {
      return;
    }
    
    await createNotification('Error: ' + error.message);
  }
}

// Renamed original function to handle homepage headlines
async function summarizeHomepageHeadlines(isArticle = false) {
  let model = "";
  let customPrompt = "";
  let systemPrompt = "";
  let preferedLang = "english";
  let mode = "";
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

- Robotic, factual, no clickbait
- Summarize the key point of the article
- Keep the original language (if Hebrew, give new Hebrew title) and similar length
- Be objective and informative`;

  try {
    const settings = await chrome.storage.sync.get(['characterMode', 'customPrompt', 'systemPrompt', 'preferedLang']);
    customPrompt = settings.customPrompt || defaultPrompt;
    systemPrompt = settings.systemPrompt || defaultSystemPrompt;
    preferedLang = settings.preferedLang || preferedLang;
    mode = settings.characterMode || 'robot';
  } catch (error) {
    if (!isAutomaticProcessing) {
      await createNotification('Error loading settings. Please try again.');
    }
  }
  const apiOptions = {"customPrompt": customPrompt, "systemPrompt": systemPrompt, "preferedLang": preferedLang, "mode": mode}; 

  const limit = 20; // Maximum headlines per click
  let firstHeadlineChanged = false;
  
  // Check premium status once at the start (instead of for each headline)
  const hasPremium = await isPremiumUser();

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
  // More lenient during automatic processing to catch more headlines
  headlines = headlines.filter(headline => {
    const style = window.getComputedStyle(headline);
    
    // Check if element is hidden via CSS
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    
    const rect = headline.getBoundingClientRect();
    
    // Check for zero dimensions (truly hidden)
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    
      // Only show headlines in current viewport
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        return false;
      }
    
    return true;
  });

  // Filter out links inside article paragraphs (only when on article page)
  // This preserves sidebar/related links but removes inline text links
  if (isArticle) {
    headlines = headlines.filter(headline => !isInsideArticleParagraph(headline));
  }

  // Filter out subject headlines (trim and filter empty strings to get actual word count)
  headlines = headlines.filter(headline => {
    const words = headline.textContent.trim().split(/\s+/).filter(w => w.length > 0);
    return words.length > 3;
  });

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
        (async () => {
          // Check cache first
          const cached = await getCachedHeadline(articleUrl, sourceHeadline, apiOptions);
          if (cached) {
            // Use cached result - instant replacement, no animation
            typeHeadline(headline, `~${cached.newHeadline}`, hasPremium, true);
            
            // Cache the summary for tooltip if premium user
            if (hasPremium && cached.summary) {
              articleSummaries.set(articleUrl, cached.summary);
            }
            
            counter++;
            return;
          }
          
          // Not in cache - fetch from AI
          const result = await fetchSummary(sourceHeadline, articleUrl, apiOptions);
          
          // Parse the JSON response using dedicated function
          const { headline: newHeadline, summary } = parseAIResponse(result, hasPremium);
          
          // Save to cache
          await setCachedHeadline(articleUrl, sourceHeadline, newHeadline, summary, apiOptions);
          
          // Cache the summary for tooltip use (only for premium users)
          if (hasPremium) {
            articleSummaries.set(articleUrl, summary);
          }

          typeHeadline(headline, `~${newHeadline}`, hasPremium, false);
          counter++;

          // Notify background to clear badge after first headline changes
          if (!firstHeadlineChanged) {
            firstHeadlineChanged = true;
            chrome.runtime.sendMessage({ action: 'headlineChanged' });
          }
        })()
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
  
  // Skip notifications during automatic processing
  if (isAutomaticProcessing) {
    return;
  }
  
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
        // Only show notification for daily rate limits, not minute-based limits
        if (rateLimitMessage.includes('Daily limit exceeded') || rateLimitMessage.includes('Daily token limit exceeded')) {
          await createNotification(rateLimitMessage);
        } else if (!isAutomaticProcessing) {
          // Only show minute-based rate limits in manual mode
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
      }
    } else {
      // Don't show generic error messages during automatic processing
      if (!isAutomaticProcessing) {
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
        if (!summary.includes('Session expired. Please sign in'))
        await createNotification(summary);
      }
    }
  }
}

// Function to parse AI response and extract headline and summary
function parseAIResponseOld(result, hasPremium) {
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
    summary = hasPremium ? parsed.article_summary || parsed.summary || parsed.description : 'Summary unavailable';
    
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
          summary = hasPremium ? extracted.article_summary || extracted.summary || extracted.description : 'Summary unavailable';
          
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

function parseAIResponseNew(result, hasPremium) {
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
        summary: hasPremium ? parsed.article_summary || parsed.summary || parsed.description : 'Summary unavailable'
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
        summary: hasPremium ? parsed.article_summary || parsed.summary || parsed.description : 'Summary unavailable'
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
          summary: hasPremium ? parsed.article_summary || parsed.summary || parsed.description : 'Summary unavailable'
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
          summary: hasPremium ? parsed.article_summary || parsed.summary || parsed.description : 'Summary unavailable'
        };
      }
    } catch (e) {
      console.log('Step 3 failed:', e.message);
    }
  }
  
  // Step 4: Manual text extraction as absolute last resort
  const headline = extractFirstFieldValue(text, 'new_headline');
  
  if (headline) {
    const summary = hasPremium ? extractSecondFieldValue(text, 'article_summary') : 'Summary unavailable';

    return {
      headline: headline.replace(/\\"/g, '"').replace(/"/g, "'").replace(/\\/g, ''),
      summary: summary || 'Summary unavailable'
    };
  }
  
  throw new Error('Could not extract headline from AI response');
}

/**
 * Robust 3-step parser that handles quotes and slashes properly
 * @param {string} result - Pre-cleaned result string
 * @returns {object} - {headline: string, summary: string}
 */
function parseAIResponse(result, hasPremium) {
  try {
    return parseAIResponseOld(result, hasPremium);
  } catch {
    return parseAIResponseNew(result, hasPremium);
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



function typeHeadline(element, text, hasPremium = false, fromCache = false) {
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
  
  // If from cache, replace immediately without animation
  if (fromCache) {
    targetElement.textContent = text;
    // Add tooltip functionality immediately (only for premium users)
    if (hasPremium) {
      setupTooltip(element);
    }
    return;
  }
  
  // Otherwise, use typing animation with improved performance
  let index = 0;
  targetElement.textContent = '';
  
  // Store interval ID on the element to prevent overlapping animations
  if (targetElement._typingInterval) {
    clearInterval(targetElement._typingInterval);
  }
  
  targetElement._typingInterval = setInterval(() => {
    // Safety check: ensure element is still in DOM
    if (!document.body.contains(targetElement)) {
      clearInterval(targetElement._typingInterval);
      targetElement._typingInterval = null;
      return;
    }
    
    if (index < text.length) {
      // Performance optimization: batch character additions for smoother animation
      const charsToAdd = Math.min(1, text.length - index); // Add up to 1 char at once
      targetElement.textContent += text.substring(index, index + charsToAdd);
      index += charsToAdd;
    } else {
      clearInterval(targetElement._typingInterval);
      targetElement._typingInterval = null;
      // Add tooltip functionality after typing is complete (only for premium users)
      if (hasPremium) {
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
  // For article pages, the headline is not a link, so use current page URL as fallback
  const articleUrl = element.href || element.closest('a')?.href || element.querySelector('a')?.href || window.location.href;
  
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
    throw new Error('Error fetching article content ' + response?.error);
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
  const { customPrompt, systemPrompt, preferedLang, mode } = options;
  
  const response = await chrome.runtime.sendMessage({
    action: 'AIcall',
    content,
    sourceHeadline,
    prompt: customPrompt,
    systemPrompt,
    preferedLang,
    mode
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

// New helper function to summarize content directly (without fetching from URL)
async function summarizeContentDirectly(sourceHeadline, content, options) {
  return await summarizeContnet(sourceHeadline, content, options);
}

// Helper function to create an isolated popup container using Shadow DOM
function createIsolatedPopup() {
  const host = document.createElement('div');
  host.className = 'just-news-popup-host';
  // Force LTR direction and reset all inherited properties to prevent RTL and stretching issues
  host.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: auto !important;
    bottom: auto !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    pointer-events: auto !important;
    direction: ltr !important;
    text-align: left !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    float: none !important;
    display: block !important;
    transform: none !important;
    flex: none !important;
    align-self: auto !important;
    justify-self: auto !important;
  `;
  
  const shadow = host.attachShadow({ mode: 'closed' });
  
  // Base styles that apply to all popups - completely isolated from website CSS
  const baseStyles = document.createElement('style');
  baseStyles.textContent = `
    :host {
      all: initial !important;
      direction: ltr !important;
    }
    
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
      direction: ltr;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    @keyframes gradientShift {
      0% { background-position: 0% 50% }
      50% { background-position: 100% 50% }
      100% { background-position: 0% 50% }
    }
    
    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      justify-content: center;
      align-items: center;
      backdrop-filter: blur(4px);
      animation: fadeIn 0.2s ease;
      direction: ltr;
      margin: 0;
      padding: 0;
      z-index: 2147483647;
      isolation: isolate;
    }
    
    .popup-box {
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
      width: 90%;
      max-width: 400px;
      max-height: 90vh;
      overflow-y: auto;
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      text-align: center;
      position: relative;
      direction: ltr;
      flex: none;
      align-self: center;
      z-index: 2147483647;
    }
    
    .popup-box-small {
      max-width: 380px;
      padding: 20px 20px;
      min-height: auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    
    .popup-box-large {
      padding: 28px 28px 24px 28px;
    }
    
    h3 {
      font-size: 20px;
      color: #1a1a1a;
      font-weight: 600;
      margin: 0 0 8px 0;
      line-height: 1.3;
      letter-spacing: -0.3px;
      text-align: center;
    }
    
    p {
      font-size: 15px;
      color: #666;
      margin: 0;
      line-height: 1.5;
      text-align: center;
    }
    
    button {
      font-family: inherit;
      cursor: pointer;
      border: none;
      outline: none;
    }
    
    .btn-primary {
      background: #4285F4;
      color: white;
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    
    .btn-primary:hover {
      background: #1a73e8;
      transform: translateY(-1px);
    }
    
    .btn-google {
      background: white;
      color: #3c4043;
      border: 1px solid #dadce0;
      padding: 14px 24px;
      border-radius: 10px;
      font-size: 1em;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      max-width: 300px;
      margin: 0 auto;
      box-shadow: 0 2px 10px rgba(66,133,244,0.10);
      transition: all 0.15s ease;
    }
    
    .btn-google:hover {
      background: #f8f9fa;
      border-color: #d2d3d4;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .btn-google svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    
    .btn-secondary {
      background: transparent;
      color: #5f6368;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    
    .btn-secondary:hover {
      background: #f8f9fa;
      color: #3c4043;
    }
    
    .close-btn {
      position: absolute;
      top: 8px;
      right: 10px;
      background: transparent;
      color: #888;
      font-size: 24px;
      font-weight: 700;
      line-height: 1;
      padding: 0 4px;
      transition: color 0.2s;
    }
    
    .close-btn:hover {
      color: #4285F4;
    }
    
    .icon-container {
      width: 40px;
      height: 40px;
      margin: 0 auto 12px auto;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    
    .icon-container img {
      width: 40px;
      height: 40px;
      border-radius: 10px;
    }
    
    .mode-selector {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    
    .mode-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: white;
      border: 2px solid transparent;
      border-radius: 12px;
      padding: 12px 14px;
      min-width: 95px;
      min-height: 90px;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 2px 12px rgba(66,133,244,0.10);
    }
    
    .mode-btn.selected {
      background: #4285F4;
      color: white;
      box-shadow: 0 6px 24px rgba(66,133,244,0.25);
      border-color: #4285F4;
    }
    
    .mode-btn.selected img {
      filter: brightness(0) invert(1);
    }
    
    .mode-btn.selected .mode-label,
    .mode-btn.selected .mode-desc {
      color: white;
    }
    
    .mode-btn img {
      width: 36px;
      height: 36px;
      margin-bottom: 8px;
    }
    
    .mode-label {
      font-weight: 700;
      font-size: 1em;
      color: #333;
      margin-bottom: 4px;
    }
    
    .mode-desc {
      font-size: 0.85em;
      opacity: 0.85;
      color: #333;
      font-weight: 400;
    }
    
    .mode-section {
      background: #f6faff;
      border-radius: 10px;
      padding: 6px 2px 4px 2px;
      margin-bottom: 8px;
      box-shadow: 0 1px 4px rgba(66,133,244,0.03);
    }
    
    .mode-section-label {
      text-align: center;
      font-size: 0.9em;
      color: #4285F4;
      font-weight: 500;
      margin-bottom: 2px;
      opacity: 0.7;
    }
    
    .auto-replace-container {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
      gap: 6px;
    }
    
    .auto-replace-container input[type="checkbox"] {
      margin-right: 4px;
      transform: scale(1.1);
      accent-color: #4285F4;
    }
    
    .auto-replace-container label {
      font-size: 0.9em;
      color: #4285F4;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
    }
    
    .sign-in-section {
      text-align: center;
    }
    
    .sign-in-label {
      font-size: 1.1em;
      color: #1a1a1a;
      font-weight: 700;
      margin-bottom: 10px;
      letter-spacing: -0.3px;
    }
    
    .button-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    
    .upgrade-btn {
      position: relative;
      padding: 2px;
      border-radius: 30px;
      background: linear-gradient(135deg, #8A2BE2 0%, #58CC02 25%, #6200EE 50%, #58CC02 75%, #8A2BE2 100%);
      background-size: 300% 300%;
      animation: gradientShift 8s linear infinite;
      text-decoration: none;
      cursor: pointer;
      width: 100%;
      display: block;
    }
    
    .upgrade-btn span {
      display: block;
      background: transparent;
      color: white;
      padding: 14px 24px;
      border-radius: 28px;
      font-size: 15px;
      font-weight: 600;
      transition: all 0.3s ease;
      text-align: center;
    }
    
    .upgrade-btn:hover span {
      background: white;
      color: #6200EE;
    }
    
    .message-text {
      margin: 0 0 32px 0;
    }
  `;
  shadow.appendChild(baseStyles);
  
  return { host, shadow };
}

function createNotificationPrompt(message) {
  const { host, shadow } = createIsolatedPopup();
  
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  const promptBox = document.createElement('div');
  promptBox.className = 'popup-box popup-box-small';

  const title = document.createElement('div');
  title.style.cssText = 'text-align: center; color: #333; margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; font-weight: 400; white-space: pre-line;';
  title.textContent = message;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 12px;';

  const cancelButton = document.createElement('button');
  cancelButton.className = 'btn-primary';
  cancelButton.textContent = 'OK';

  buttonContainer.appendChild(cancelButton);
  promptBox.appendChild(title);
  promptBox.appendChild(buttonContainer);
  overlay.appendChild(promptBox);
  shadow.appendChild(overlay);

  return { host, cancelButton };
}

async function createNotification(message) {
  return new Promise((resolve, reject) => {
    const { host, cancelButton } = createNotificationPrompt(message);
    document.body.appendChild(host);

    cancelButton.onclick = () => {
      document.body.removeChild(host);
      resolve(null);
    };
  });
}

// Show login prompt to user
function showLoginPrompt() {
  const { host, shadow } = createIsolatedPopup();
  
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  const promptBox = document.createElement('div');
  promptBox.className = 'popup-box popup-box-large';

  // Close button
  const closeButton = document.createElement('button');
  closeButton.className = 'close-btn';
  closeButton.innerHTML = '&times;';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.onclick = () => {
    host.remove();
    isLoginPromptShown = false;
  };

  // Logo/Icon at the top
  const iconContainer = document.createElement('div');
  iconContainer.className = 'icon-container';
  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/icon128.png');
  iconContainer.appendChild(icon);

  const title = document.createElement('h3');
  title.textContent = 'Welcome to Just News';

  // Mode configs
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

  // Mode selector container
  const modeSelectorContainer = document.createElement('div');
  modeSelectorContainer.className = 'mode-selector';

  // Mode button factory
  function createModeButton(mode, iconUrl, label, desc) {
    const btn = document.createElement('div');
    btn.className = 'mode-btn' + (mode === currentMode ? ' selected' : '');

    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = label;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mode-label';
    nameSpan.textContent = label;

    const descSpan = document.createElement('span');
    descSpan.className = 'mode-desc';
    descSpan.textContent = desc;

    btn.appendChild(img);
    btn.appendChild(nameSpan);
    btn.appendChild(descSpan);

    btn.onclick = () => {
      if (currentMode === mode) return;
      currentMode = mode;
      Array.from(modeSelectorContainer.children).forEach(child => child.classList.remove('selected'));
      btn.classList.add('selected');
      chrome.storage.sync.set({
        characterMode: mode,
        systemPrompt: characterConfigs[mode].systemPrompt,
        customPrompt: characterConfigs[mode].userPrompt
      });
    };
    return btn;
  }

  // Add mode buttons
  modeSelectorContainer.appendChild(createModeButton('robot', chrome.runtime.getURL('icons2/robot.png'), 'Robot', 'Factual'));
  modeSelectorContainer.appendChild(createModeButton('clean', chrome.runtime.getURL('icons2/clean.png'), 'Clean', 'Ethical'));

  // Mode section wrapper
  const modeSection = document.createElement('div');
  modeSection.className = 'mode-section';
  const modeLabel = document.createElement('div');
  modeLabel.className = 'mode-section-label';
  modeLabel.textContent = 'Choose your mode:';
  modeSection.appendChild(modeLabel);
  modeSection.appendChild(modeSelectorContainer);

  // Auto Replace Headlines Checkbox
  const autoReplaceContainer = document.createElement('div');
  autoReplaceContainer.className = 'auto-replace-container';
  const autoReplaceCheckbox = document.createElement('input');
  autoReplaceCheckbox.type = 'checkbox';
  autoReplaceCheckbox.id = 'jn-auto-replace-checkbox';
  autoReplaceCheckbox.checked = true;
  const autoReplaceLabel = document.createElement('label');
  autoReplaceLabel.htmlFor = 'jn-auto-replace-checkbox';
  autoReplaceLabel.textContent = 'Auto-replace on page load';
  autoReplaceContainer.appendChild(autoReplaceCheckbox);
  autoReplaceContainer.appendChild(autoReplaceLabel);

  // Load previous auto-replace setting
  chrome.storage.sync.get(['autoReplaceHeadlines'], (data) => {
    if (typeof data.autoReplaceHeadlines === 'boolean') {
      autoReplaceCheckbox.checked = data.autoReplaceHeadlines;
    }
  });

  // Sign in section
  const signInSection = document.createElement('div');
  signInSection.className = 'sign-in-section';

  // Button container
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'button-container';

  // Google login button
  const loginButton = document.createElement('button');
  loginButton.className = 'btn-google';
  loginButton.innerHTML = `
    <svg viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
    <span>Continue with Google</span>
  `;

  loginButton.addEventListener('click', async () => {
    loginButton.disabled = true;
    loginButton.textContent = 'Signing in...';
    chrome.storage.sync.set({
      characterMode: currentMode,
      systemPrompt: characterConfigs[currentMode].systemPrompt,
      customPrompt: characterConfigs[currentMode].userPrompt,
      autoReplaceHeadlines: autoReplaceCheckbox.checked
    }, async () => {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'login' });
        if (response.success) {
          host.remove();
          isLoginPromptShown = false;
          summarizeHeadlines();
        } else {
          await createNotification('Login failed: ' + response.error);
          host.remove();
          isLoginPromptShown = false;
        }
      } catch (error) {
        await createNotification('Login error: ' + error.message);
        host.remove();
        isLoginPromptShown = false;
      }
    });
  });

  // Assemble the UI
  buttonContainer.appendChild(autoReplaceContainer);
  buttonContainer.appendChild(loginButton);
  signInSection.appendChild(buttonContainer);

  promptBox.appendChild(closeButton);
  promptBox.appendChild(iconContainer);
  promptBox.appendChild(title);
  promptBox.appendChild(modeSection);
  promptBox.appendChild(signInSection);
  overlay.appendChild(promptBox);
  shadow.appendChild(overlay);
  document.body.appendChild(host);
}

// Show premium upgrade notification with styled "Maybe later" button
function createPremiumNotification(message) {
  return new Promise((resolve) => {
    const { host, shadow } = createIsolatedPopup();
    
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const notificationBox = document.createElement('div');
    notificationBox.className = 'popup-box popup-box-large';

    // Icon at the top
    const iconContainer = document.createElement('div');
    iconContainer.className = 'icon-container';
    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon128.png');
    iconContainer.appendChild(icon);

    const title = document.createElement('h3');
    title.textContent = 'Daily Limit Reached';

    const messageText = document.createElement('p');
    messageText.className = 'message-text';
    messageText.textContent = message;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'button-container';

    // Upgrade to Premium button with gradient animation
    const upgradeButton = document.createElement('a');
    upgradeButton.href = 'https://tsurdan.github.io/Just-News/premium.html';
    upgradeButton.target = '_blank';
    upgradeButton.className = 'upgrade-btn';

    const upgradeSpan = document.createElement('span');
    upgradeSpan.textContent = 'Upgrade to Premium';
    upgradeButton.appendChild(upgradeSpan);

    const maybeLaterButton = document.createElement('button');
    maybeLaterButton.className = 'btn-secondary';
    maybeLaterButton.textContent = 'Maybe later';

    maybeLaterButton.addEventListener('click', () => {
      host.remove();
      resolve();
    });

    buttonContainer.appendChild(upgradeButton);
    buttonContainer.appendChild(maybeLaterButton);
    notificationBox.appendChild(iconContainer);
    notificationBox.appendChild(title);
    notificationBox.appendChild(messageText);
    notificationBox.appendChild(buttonContainer);
    overlay.appendChild(notificationBox);
    shadow.appendChild(overlay);
    document.body.appendChild(host);
  });
}

// Initialize cache cleanup on startup (run once per page load)
cleanupCacheIfNeeded().catch(err => console.error('Initial cache cleanup failed:', err));

initializeContentScript();