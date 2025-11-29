export default {
  async fetch(request, env) {
    // Handle OPTIONS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": `chrome-extension://${env.EXTENSION_ID}`,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-JustNews-Key",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Check shared secret header
    const clientKey = request.headers.get("X-JustNews-Key");
    if (!clientKey || clientKey !== env.CLIENT_SECRET) {
      return new Response("Unauthorized", { status: 401, headers: {
        "Access-Control-Allow-Origin": `chrome-extension://${env.EXTENSION_ID}`
      }});
    }

    // Parse JSON body
    let jsonBody;
    try {
      jsonBody = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400, headers: {
        "Access-Control-Allow-Origin": `chrome-extension://${env.EXTENSION_ID}`
      }});
    }

    // Forward to Groq API
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(jsonBody)
    });

    const text = await groqRes.text();
    const responseHeaders = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": `chrome-extension://${env.EXTENSION_ID}`
    };

    return new Response(text, { status: groqRes.status, headers: responseHeaders });
  }
};