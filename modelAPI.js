//const { OpenAI } = require("openai");
//import { OpenAI } from "openai";
import fetch from "node-fetch";

const baseURL =  "https://api.aimlapi.com/v1/chat/completions";
const apiKey = "dd6d0596ce7b4bc2825a316c87dfc1b7";
const systemPrompt = "You are a travel agent. Be descriptive and helpful";
const prompt = "Tell me about San Francisco";

// const api = new OpenAI({
//   apiKey,
//   baseURL,
// });

const main = async () => {
      const body = JSON.stringify({
      model: "gpt-4o-2024-05-13", //claude-3-opus-20240229
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
      max_tokens: 20,
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