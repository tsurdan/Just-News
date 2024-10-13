async function summarizeHeadlines() {
  let counter = 0;
  const limit = 30;

  // This function will be injected into the page
  let headlines = Array.from(document.querySelectorAll('a, h1, h2, h3, h4, h5, h6'));

  // Filter out headlines with images
  headlines = headlines.filter(headline => !headline.querySelector('img'));

  // Filter out subject headlines
  headlines = headlines.filter(headline => headline.textContent.split(' ').length > 2);

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
        fetchSummary(articleUrl).then(summary => {
          headline.textContent = summary;
          counter++;
        })
      );
    }
  }

  await Promise.all(promises);
}

async function fetchSummary(url) {
  // This is a placeholder function. You'll need to implement the actual API call.
  // const response = await fetch('YOUR_LANGUAGE_MODEL_API', {
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