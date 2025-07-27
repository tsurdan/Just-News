document.addEventListener('DOMContentLoaded', () => {
  const apiProvider = document.getElementById('apiProvider');
  const apiKey = document.getElementById('apiKey');
  const customPrompt = document.getElementById('customPrompt');
  const systemPrompt = document.getElementById('systemPrompt');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const status = document.getElementById('status');
  const characterModes = document.querySelectorAll('.character-mode');

  // Custom dropdown elements
  const selectSelected = document.getElementById('selectSelected');
  const selectItems = document.getElementById('selectItems');
  const providerIcon = document.getElementById('providerIcon');

  // Default models for each API provider
  const defaultModels = {
    groq: 'gemma2-9b-it',
    openai: 'gpt-3.5-turbo',
    claude: 'claude-3-opus<',
    gemini: 'gemini-1.5-flash-latest'
  };

  // Character mode configurations
  const characterConfigs = {
    robot: {
      systemPrompt: "Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.",
      userPrompt: "Rewrite the headline, based on the article, with these rules:\n\nRobotic, factual, no clickbait.\nSummarizing the key point of the article.\nKeep the original headline length and language (if hebrew generate hebrew headline)."
    },
    cynic: {
      systemPrompt: "You are a cynical, highly intelligent, and sarcastic analyst. You break down headlines with wit and sharp commentary. Your tone is casual, jaded, and often darkly humorous.",
      userPrompt: "Rewrite this headline, based on the article, in your usual sarcastic tone. Expose any nonsense and dont sugarcoat anything. you can use foul language.\n Keep the original headline length and language (if hebrew generate hebrew headline)."
    },
    kid: {
      systemPrompt: "You are a kind, patient kid who explains things in very simple, child-friendly language. You use short sentences, familiar ideas, and comforting tone. Avoid sarcasm, big words, or negative framing.",
      userPrompt: "Please rewrite this headline, based on the article, so that a 5-year-old could understand what it's about.\n Keep the original headline length and language (if hebrew generate hebrew headline)."
    },
    optimist: {
      systemPrompt: "You are an enthusiastic, optimistic influencer who turns every news headline into an exciting update. Use positive tone, modern slang, exclamation marks, and emojis. Keep it short and hype-y.",
      userPrompt: "Rewrite this headline, based on the article, like you're hyping it up for social media followers—make it fun eye-catching and optimistic!\n Keep the original headline length and language (if hebrew generate hebrew headline)."
    },
    conspirator: {
      systemPrompt: "You are a suspicious and cryptic narrator who always suspects there’s more beneath the surface. Rewrite headlines to hint at possible hidden truths or agendas. Be subtle but unsettling. Use language like “allegedly,” “some suspect,” or “was it really…?”",
      userPrompt: "Rewrite this headline, based on the article, as if there might be something secret going on that the media isn’t telling us.\n Keep the original headline length and language (if hebrew generate hebrew headline)."
    }
  };

  let currentCharacterMode = 'robot';

  // Default prompts
  const defaultSystemPrompt = characterConfigs.robot.systemPrompt;
  const defaultPrompt = characterConfigs.robot.userPrompt;

  // Load saved settings
  chrome.storage.sync.get(['apiProvider', 'apiKey', 'customPrompt', 'systemPrompt', 'characterMode'], (data) => {
    if (data.apiProvider) {
      apiProvider.value = data.apiProvider;
      // Update custom dropdown display
      const selectedItem = document.querySelector(`[data-value="${data.apiProvider}"]`);
      if (selectedItem) {
        selectSelected.textContent = selectedItem.textContent.trim();
        document.querySelectorAll('.select-items div').forEach(div => {
          div.classList.remove('same-as-selected');
        });
        selectedItem.classList.add('same-as-selected');
      }
    }
    updateProviderIcon(); // Set initial icon
    
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
    
    // Set character mode
    currentCharacterMode = data.characterMode || 'robot';
    updateCharacterModeUI();
    
    // Set prompts - use saved values if available, otherwise use character defaults
    systemPrompt.value = (typeof data.systemPrompt === 'string' && data.systemPrompt.trim().length > 0)
      ? data.systemPrompt
      : characterConfigs[currentCharacterMode].systemPrompt;
    customPrompt.value = (typeof data.customPrompt === 'string' && data.customPrompt.trim().length > 0)
      ? data.customPrompt
      : characterConfigs[currentCharacterMode].userPrompt;
  });

  // Character mode selection
  characterModes.forEach(mode => {
    mode.addEventListener('click', () => {
      const selectedMode = mode.dataset.mode;
      currentCharacterMode = selectedMode;
      updateCharacterModeUI();
      
      // Update prompts based on selected character (but keep them editable)
      const config = characterConfigs[selectedMode];
      systemPrompt.value = config.systemPrompt;
      customPrompt.value = config.userPrompt;
    });
  });

  function updateCharacterModeUI() {
    characterModes.forEach(mode => {
      if (mode.dataset.mode === currentCharacterMode) {
        mode.classList.add('selected');
      } else {
        mode.classList.remove('selected');
      }
    });
  }

  // Custom dropdown functionality
  selectSelected.addEventListener('click', () => {
    selectItems.classList.toggle('select-hide');
    selectSelected.classList.toggle('select-arrow-active');
  });

  selectItems.addEventListener('click', (e) => {
    if (e.target.hasAttribute('data-value') || e.target.parentElement.hasAttribute('data-value')) {
      const item = e.target.hasAttribute('data-value') ? e.target : e.target.parentElement;
      const value = item.getAttribute('data-value');
      const text = item.textContent.trim();
      
      // Update hidden input and display
      apiProvider.value = value;
      selectSelected.textContent = text;
      
      // Update icon
      updateProviderIcon();
      
      // Clear API key when provider changes
      apiKey.value = "";
      apiKey.dataset.real = "";
      
      // Close dropdown
      selectItems.classList.add('select-hide');
      selectSelected.classList.remove('select-arrow-active');
      
      // Update selected state
      document.querySelectorAll('.select-items div').forEach(div => {
        div.classList.remove('same-as-selected');
      });
      item.classList.add('same-as-selected');
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) {
      selectItems.classList.add('select-hide');
      selectSelected.classList.remove('select-arrow-active');
    }
  });

  function updateProviderIcon() {
    const iconElement = document.getElementById('providerIcon');
    const selectedValue = apiProvider.value;
    iconElement.src = `more icons/${selectedValue}.png`;
    iconElement.alt = selectedValue.charAt(0).toUpperCase() + selectedValue.slice(1);
  }

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

  saveBtn.onclick = () => {
    // Save the real key if present, otherwise the visible value
    const keyToSave = apiKey.dataset.real || apiKey.value;
    // Get the default model for the selected provider
    const selectedModel = defaultModels[apiProvider.value];
    
    chrome.storage.sync.set({
      apiProvider: apiProvider.value,
      apiKey: keyToSave,
      model: selectedModel,
      customPrompt: customPrompt.value,
      systemPrompt: systemPrompt.value,
      characterMode: currentCharacterMode
    }, () => {
      status.textContent = 'Saved!';
      setTimeout(() => status.textContent = '', 1500);
    });
  };

  cancelBtn.onclick = () => {
    window.close();
  };
});