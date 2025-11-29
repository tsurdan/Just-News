async function testWorker() {
  const url = "https://just-news-proxy.tzurda3.workers.dev";

  const payload = {
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: "Your a travel guid" },
      { role: "user", content: "Tell me about Paris" }
    ],
    max_tokens: 50
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-JustNews-Key": ""
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Worker error:", text);
      return;
    }

    const data = await response.json();
    console.log("AI Response:", data?.choices?.[0]?.message?.content);
  } catch (err) {
    console.error("Network error:", err);
  }
}

testWorker();
