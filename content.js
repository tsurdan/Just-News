async function summarizeHeadlines() {
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
        fetchSummary(articleUrl).then(summary => {
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
async function fetchSummary(url) {
  let summary = "";
  try {
    const content = await fetchContent(url);
    summary = await summarizeContnet(content);//.split(' ').slice(0, 50).join(' '));
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

async function summarizeContnet(content) {
  const prompt = "please summarize this article to an informative (not clickbate) and short headline, in the article language: " + content;
  const response = await chrome.runtime.sendMessage({ action: 'AIcall', prompt: prompt });
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

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'summarizeHeadlines') {
    summarizeHeadlines();
  }
});


