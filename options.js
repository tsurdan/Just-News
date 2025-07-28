document.addEventListener('DOMContentLoaded', () => {
  const apiProvider = document.getElementById('apiProvider');
  const apiKey = document.getElementById('apiKey');
  const customPrompt = document.getElementById('customPrompt');
  const systemPrompt = document.getElementById('systemPrompt');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const resetBtn = document.getElementById('resetBtn');
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
    custom: {
      systemPrompt: "",
      userPrompt: ""
    },
    cynic: {
      systemPrompt: "You are a cynical, highly intelligent, and sarcastic analyst. You break down headlines with wit and sharp commentary. Your tone is casual, jaded, and often darkly humorous.",
      userPrompt: "Rewrite this headline, based on the article, in your usual sarcastic tone. Expose any nonsense and dont sugarcoat anything. you can use foul language.\n Keep the original headline length and language (if hebrew generate hebrew headline)."
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
  
  // Store for modified prompts
  let modifiedPrompts = {};

  // Default prompts
  const defaultSystemPrompt = characterConfigs.robot.systemPrompt;
  const defaultPrompt = characterConfigs.robot.userPrompt;

  // Load saved settings
  chrome.storage.sync.get(['apiProvider', 'apiKey', 'customPrompt', 'systemPrompt', 'characterMode', 'modifiedPrompts'], (data) => {
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
    
    // Load saved modified prompts if available
    if (data.modifiedPrompts) {
      modifiedPrompts = data.modifiedPrompts;
    }
    
    // Set prompts - check for modified prompts first
    if (modifiedPrompts[currentCharacterMode]) {
      systemPrompt.value = modifiedPrompts[currentCharacterMode].systemPrompt;
      customPrompt.value = modifiedPrompts[currentCharacterMode].userPrompt;
    } else {
      // Use saved values or character defaults
      systemPrompt.value = (typeof data.systemPrompt === 'string' && data.systemPrompt.trim().length > 0)
        ? data.systemPrompt
        : characterConfigs[currentCharacterMode].systemPrompt;
      customPrompt.value = (typeof data.customPrompt === 'string' && data.customPrompt.trim().length > 0)
        ? data.customPrompt
        : characterConfigs[currentCharacterMode].userPrompt;
      
      // Initialize modified prompts with current values
      modifiedPrompts[currentCharacterMode] = {
        systemPrompt: systemPrompt.value,
        userPrompt: customPrompt.value
      };
    }
  });

  // Character mode selection
  characterModes.forEach(mode => {
    mode.addEventListener('click', () => {
      // Save current prompts before switching
      saveCurrentPrompts();
      
      const selectedMode = mode.dataset.mode;
      currentCharacterMode = selectedMode;
      updateCharacterModeUI();
      
      // Load prompts for selected character (check for modified versions first)
      loadPromptsForMode(selectedMode);
    });
  });

  function saveCurrentPrompts() {
    // Save the current prompts for the current mode
    modifiedPrompts[currentCharacterMode] = {
      systemPrompt: systemPrompt.value,
      userPrompt: customPrompt.value
    };
    
    // Save to storage immediately
    chrome.storage.sync.set({ modifiedPrompts: modifiedPrompts });
  }

  function loadPromptsForMode(mode) {
    // Check if we have modified prompts for this mode first
    if (modifiedPrompts[mode]) {
      systemPrompt.value = modifiedPrompts[mode].systemPrompt;
      customPrompt.value = modifiedPrompts[mode].userPrompt;
    } else {
      // Use default prompts for the mode
      const config = characterConfigs[mode];
      systemPrompt.value = config.systemPrompt;
      customPrompt.value = config.userPrompt;
    }
  }

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
    // Save current prompts before validation
    saveCurrentPrompts();
    
    // Validate custom mode prompts
    if (currentCharacterMode === 'custom') {
      const systemPromptValue = systemPrompt.value.trim();
      const customPromptValue = customPrompt.value.trim();
      
      if (systemPromptValue === '' || customPromptValue === '') {
        status.textContent = 'Custom mode requires both prompts to be filled!';
        status.style.color = '#dc3545';
        setTimeout(() => {
          status.textContent = '';
          status.style.color = '#4285F4';
        }, 3000);
        return;
      }
    }
    
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
      characterMode: currentCharacterMode,
      modifiedPrompts: modifiedPrompts
    }, () => {
      status.textContent = 'Saved!';
      status.style.color = '#4285F4';
      setTimeout(() => status.textContent = '', 1500);
    });
  };

  cancelBtn.onclick = () => {
    // Save current prompts before closing
    saveCurrentPrompts();
    window.close();
  };

  // Auto-save prompts when window closes
  window.addEventListener('beforeunload', () => {
    saveCurrentPrompts();
  });

  resetBtn.onclick = () => {
    if (confirm('Are you sure you want to reset all settings? This will clear all data including API keys and custom prompts.')) {
      // Clear all storage
      chrome.storage.sync.clear(() => {
        // Reset form to defaults
        apiProvider.value = 'groq';
        selectSelected.textContent = 'Groq';
        document.querySelectorAll('.select-items div').forEach(div => {
          div.classList.remove('same-as-selected');
        });
        document.querySelector('[data-value="groq"]').classList.add('same-as-selected');
        updateProviderIcon();
        
        apiKey.value = '';
        apiKey.dataset.real = '';
        
        currentCharacterMode = 'robot';
        updateCharacterModeUI();
        
        // Reset prompts to defaults
        systemPrompt.value = characterConfigs.robot.systemPrompt;
        customPrompt.value = characterConfigs.robot.userPrompt;
        
        // Clear modified prompts
        modifiedPrompts = {};
        modifiedPrompts[currentCharacterMode] = {
          systemPrompt: systemPrompt.value,
          userPrompt: customPrompt.value
        };
        
        status.textContent = 'Settings Reset!';
        status.style.color = '#4285F4';
        setTimeout(() => status.textContent = '', 2000);
      });
    }
  };
});