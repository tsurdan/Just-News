//const { OpenAI } = require("openai");
//import { OpenAI } from "openai";
import fetch from "node-fetch";

const baseURL =  "https://api.groq.com/openai/v1/chat/completions";
const apiKey = "";
const systemPrompt = "You are a travel agent. Be descriptive and helpful ansower in the user language(hebrew)";
const prompt = "תספר לי בבקשה קצת על סן פרנסיסקו";

// const api = new OpenAI({
//   apiKey,
//   baseURL,
// });

const main = async () => {
      const body = JSON.stringify({
      model: "gemma2-9b-it", //claude-3-opus-20240229
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
      max_tokens: 100,
    });

    fetch(baseURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: body,
    })
    .then(response => response.json())
    .then(data => {
      const response1 = JSON.stringify(data.choices[0].message.content);

      console.log("User:", prompt);
      console.log("AI:", response1);
    })
    .catch(error => {
      console.error('Error fetching summary:', error);
    });
};

main();