document.addEventListener('DOMContentLoaded', () => {
  const apiProvider = document.getElementById('apiProvider');
  const apiKey = document.getElementById('apiKey');
  const model = document.getElementById('model');
  const customPrompt = document.getElementById('customPrompt');
  const systemPrompt = document.getElementById('systemPrompt');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const status = document.getElementById('status');

  // Default prompts
  const defaultSystemPrompt = `Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article’s language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article’s main takeaway without needing to read it.`;
  const defaultPrompt = `Rewrite the headline with these rules:

Robotic, factual, no clickbait.
Summarizing the key point of the article.
Keep the original language (if it hebrew give new hebrew title) and length.`;

  // Load saved settings
  chrome.storage.sync.get(['apiProvider', 'apiKey', 'model', 'customPrompt', 'systemPrompt'], (data) => {
    if (data.apiProvider) apiProvider.value = data.apiProvider;
    // Show only first and last 2 chars of key, mask the rest
    if (data.apiKey && data.apiKey.length > 6) {
      const masked = data.apiKey.slice(0, 3) + "****" + data.apiKey.slice(-2);
      apiKey.value = masked;
      apiKey.dataset.real = data.apiKey; // store real key for save
    } else if (data.apiKey) {
      apiKey.value = data.apiKey;
      apiKey.dataset.real = data.apiKey;
    } else {
      apiKey.value = "";
      apiKey.dataset.real = "";
    }
    if (data.model) model.value = data.model;
    systemPrompt.value = (typeof data.systemPrompt === 'string' && data.systemPrompt.trim().length > 0)
      ? data.systemPrompt
      : defaultSystemPrompt;
    customPrompt.value = (typeof data.customPrompt === 'string' && data.customPrompt.trim().length > 0)
      ? data.customPrompt
      : defaultPrompt;
    updateModelOptions();
  });

  // Change model options based on provider
  apiProvider.addEventListener('change', () => {
    updateModelOptions();
    apiKey.value = "";
    apiKey.dataset.real = "";
  });

  // When user focuses the key input, show the real key if available
  apiKey.addEventListener('focus', () => {
    if (apiKey.dataset.real) {
      apiKey.value = apiKey.dataset.real;
    }
  });
  // When user blurs the key input, mask it again if not empty
  apiKey.addEventListener('blur', () => {
    if (apiKey.value && apiKey.value.length > 6) {
      apiKey.dataset.real = apiKey.value;
      apiKey.value = apiKey.value.slice(0, 3) + "****" + apiKey.value.slice(-2);
    }
  });

  function updateModelOptions() {
    const provider = apiProvider.value;
    Array.from(model.options).forEach(opt => {
      if (provider === 'groq' && (opt.value.startsWith('gpt-') || opt.value.startsWith('claude-') || opt.value.startsWith('gemini-') )) opt.style.display = 'none';
      else if (provider === 'openai' && !opt.value.startsWith('gpt-')) opt.style.display = 'none';
      else if (provider === 'claude' && !opt.value.startsWith('claude-')) opt.style.display = 'none';
      else if (provider === 'gemini' && !opt.value.startsWith('gemini-')) opt.style.display = 'none';
      else opt.style.display = '';
    });
    // Select first visible option
    for (let opt of model.options) {
      if (opt.style.display !== 'none') {
        model.value = opt.value;
        break;
      }
    }
    // Show default prompt if box is empty
    if (!customPrompt.value.trim()) {
      customPrompt.value = defaultPrompt;
    }
  }

  saveBtn.onclick = () => {
    // Save the real key if present, otherwise the visible value
    const keyToSave = apiKey.dataset.real || apiKey.value;
    chrome.storage.sync.set({
      apiProvider: apiProvider.value,
      apiKey: keyToSave,
      model: model.value,
      customPrompt: customPrompt.value,
      systemPrompt: systemPrompt.value
    }, () => {
      status.textContent = 'Saved!';
      setTimeout(() => status.textContent = '', 1500);
    });
  };

  cancelBtn.onclick = () => {
    window.close();
  };
});