import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';

// Function to fetch and scrape article text
async function fetchArticleText(url) {
  try {
    // Fetch the HTML content from the URL
    const response = await fetch(url);
    const data = await response.text(); // Get the response as text

    // Load the HTML into cheerio for parsing
    const $ = cheerio.load(data);

    // Example selectors for news websites
    let articleText = '';
    const contentSelectors = ['article', '.article-content', '.post-content', '.entry-content'];

    for (const selector of contentSelectors) {
      if ($(selector).length) {
        articleText = $(selector).text().trim();
        break; // Stop when content is found
      }
    }

    if (articleText) {
      console.log('Article Text:');
      articleText = articleText.replace(/^\s*$(?:\r\n?|\n)/gm, '');
      articleText = articleText.replace(/\{[^}]*\}/g, '');
      fs.writeFileSync('article.txt', articleText); 
      console.log(articleText);
    } else {
      console.log('No article content found for the given URL.');
    }
  } catch (error) {
    console.error('Error fetching article:', error.message);
  }
}

// Example usage
const url = 'https://www.mako.co.il/news-military/036814c74a0e1910/Article-230432925fe8291026.htm?sCh=31750a2610f26110&pId=173113802'; // Replace with a valid news URL
fetchArticleText(url);
