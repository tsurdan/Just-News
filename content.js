function summarizeHeadlines() {
  // This function will be injected into the page
  let headlines = document.querySelectorAll('a');
  headlines.forEach(async (headline) => {
    const articleUrl = headline.href;
    if (articleUrl) {
      const summary = await fetchSummary(articleUrl);
      headline.textContent = summary;
    }
  });

  headlines = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headlines.forEach(async (headline) => {
    const articleLink = headline.closest('a');
    let articleUrl = articleLink?.href;
    if (articleUrl) {
      const summary = await fetchSummary(articleUrl);
      headline.textContent = summary;
    }
  });

}

async function fetchSummary(url) {
  // // This is a placeholder function. You'll need to implement the actual API call.
  // const response = await fetch('YOUR_LANGUAGE_MODEL_API_ENDPOINT', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({ url: url }),
  // });
  // const data = await response.json();
  return "Headline!";
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarizeHeadlines') {
    summarizeHeadlines();
  }
});
