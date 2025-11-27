export default {
  async fetch(request, env) {
    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Check shared secret header
    const clientKey = request.headers.get("X-JustNews-Key");
    if (!clientKey || clientKey !== env.CLIENT_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Read JSON body from extension (already formatted for Groq)
    let jsonBody;
    try {
      jsonBody = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    // Forward it to Groq API with API key injection
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(jsonBody)
    });

    // Relay Groq response directly back to the extension
    const groqText = await groqResponse.text();

    return new Response(groqText, {
      status: groqResponse.status,
      headers: { "Content-Type": "application/json" }
    });
  }
};