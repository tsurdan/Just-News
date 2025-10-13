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
  
  // Character counter elements
  const systemPromptCounter = document.getElementById('systemPromptCounter');
  const customPromptCounter = document.getElementById('customPromptCounter');

  // Custom dropdown elements
  const selectSelected = document.getElementById('selectSelected');
  const selectItems = document.getElementById('selectItems');
  const providerIcon = document.getElementById('providerIcon');
  const preferedLang = document.getElementById('preferedLang');
  
  // API key link elements
  const groqLink = document.getElementById('groqLink');
  const openaiLink = document.getElementById('openaiLink');
  const claudeLink = document.getElementById('claudeLink');
  const geminiLink = document.getElementById('geminiLink');

  // Default models for each API provider
  const defaultModels = {
    groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
    openai: 'gpt-3.5-turbo',
    claude: 'claude-3-opus',
    gemini: 'gemini-1.5-flash-latest'
  };

  // Character mode configurations
  const characterConfigs = {
    robot: {
      systemPrompt: "Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.",
      userPrompt: "Rewrite the headline, based on the article, with these rules:\n\n- Robotic, factual, no clickbait\n- Summarize the key point of the article\n- Be objective and informative\n Keep the original headline length and language"
    },
    custom: {
      systemPrompt: "",
      userPrompt: ""
    },
    cynic: {
      systemPrompt: "You are a cynical, highly intelligent, and sarcastic analyst. You break down headlines with wit and sharp commentary. Your tone is casual, jaded, and often darkly humorous.",
      userPrompt: "Rewrite this headline, based on the article, in your usual sarcastic tone. Expose any nonsense and don't sugarcoat anything. You can use foul language.\n\nKeep the original headline length and language"
    },
    optimist: {
      systemPrompt: "You are an enthusiastic, optimistic influencer who turns every news headline into an exciting update. Use positive tone, modern slang, exclamation marks, and emojis. Keep it short and hype-y.",
      userPrompt: "Rewrite this headline, based on the article, like you're hyping it up for social media followers—make it fun, eye-catching and optimistic! Try looking on the good side of anything even if it's completely absurd.\n\nYour answer must must (!) be in the original headline length and in the article language"
    },
    conspirator: {
      systemPrompt: "You are a media manipulator detector. You never summarize the article or react to its content. Instead, you rewrite the headline to expose what the article is trying to *make the reader feel, believe, or do*. Your new headline should say: - What the article is trying to achieve - What emotion or belief it wants to plant - Who benefits from it Use a short and blunt style. Some examples to opening, be creative don't just steal to this openings: - 'הכתבה מנסה לשכנע אותך ש...' - “This article wants you to feel…” - “Another piece to make you think…” - “Media trying to convince you that…” - 'התקשורת רוצה שתחשוב...' Keep it sharp, suspicious, and focused on the *publication's agenda* — not the event itself.",
      userPrompt: "What is this article trying to make people feel, believe, or do? Your answer must must (!) be in the original headline length and in the article language ."
    }
  };

  let currentCharacterMode = 'robot';
  
  // Store for modified prompts
  let modifiedPrompts = {};

  // Character counter functions
  function updateCharCounter(textarea, counter, maxLength) {
    const currentLength = textarea.value.length;
    counter.textContent = `${currentLength}/${maxLength}`;
    
    // Update styling based on usage
    counter.classList.remove('warning', 'danger');
    if (currentLength > maxLength * 0.9) {
      counter.classList.add('danger');
    } else if (currentLength > maxLength * 0.75) {
      counter.classList.add('warning');
    }
  }

  // Add input event listeners for character counting
  systemPrompt.addEventListener('input', () => {
    updateCharCounter(systemPrompt, systemPromptCounter, 1000);
  });

  customPrompt.addEventListener('input', () => {
    updateCharCounter(customPrompt, customPromptCounter, 800);
  });

  // Default prompts
  const defaultSystemPrompt = characterConfigs.robot.systemPrompt;
  const defaultPrompt = characterConfigs.robot.userPrompt;

  let ipu = false;

  // Load saved settings
  chrome.storage.sync.get(['apiProvider', 'apiKey', 'customPrompt', 'systemPrompt', 'characterMode', 'modifiedPrompts', 'premium', 'preferedLang'], (data) => {
    ipu = !!data.premium;
    updatePremiumUI(ipu);
    if (data.preferedLang) {
      preferedLang.value = data.preferedLang;
    } else {
      preferedLang.value = 'english'; // Set default to English
    }
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
    updateProviderIcon(); // Set initial icon and API key link
    
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
    
    // Update character counters
    updateCharCounter(systemPrompt, systemPromptCounter, 1000);
    updateCharCounter(customPrompt, customPromptCounter, 800);
  });

  // Check premium status and update UI accordingly
  function updatePremiumUI(ipb) {
    const characterModesContainer = document.getElementById('characterModes');
    
    // Get custom prompt elements
    const systemPromptLabel = document.querySelector('label[for="systemPrompt"]');
    const systemPromptTextarea = document.getElementById('systemPrompt');
    const systemPromptCounter = document.getElementById('systemPromptCounter');
    const customPromptLabel = document.querySelector('label[for="customPrompt"]');
    const customPromptTextarea = document.getElementById('customPrompt');
    const customPromptCounter = document.getElementById('customPromptCounter');
    
    if (ipb) {
      // Premium user - show everything
      characterModesContainer.classList.add('premium-unlocked');
      document.querySelectorAll('.premium-mode').forEach(mode => {
        mode.classList.remove('premium-mode');
        mode.removeAttribute('data-premium');
      });
      
      // Show custom prompt fields
      if (systemPromptLabel) systemPromptLabel.style.display = 'block';
      if (systemPromptTextarea) systemPromptTextarea.style.display = 'block';
      if (systemPromptCounter) systemPromptCounter.style.display = 'block';
      if (customPromptLabel) customPromptLabel.style.display = 'block';
      if (customPromptTextarea) customPromptTextarea.style.display = 'block';
      if (customPromptCounter) customPromptCounter.style.display = 'block';
    } else {
      // Non-premium user - hide custom prompts
      characterModesContainer.classList.remove('premium-unlocked');
      
      // Hide custom prompt fields
      if (systemPromptLabel) systemPromptLabel.style.display = 'none';
      if (systemPromptTextarea) systemPromptTextarea.style.display = 'none';
      if (systemPromptCounter) systemPromptCounter.style.display = 'none';
      if (customPromptLabel) customPromptLabel.style.display = 'none';
      if (customPromptTextarea) customPromptTextarea.style.display = 'none';
      if (customPromptCounter) customPromptCounter.style.display = 'none';
    }
  }

  // Add click handler for premium container
  const premiumContainer = document.querySelector('.premium-modes-container');
  if (premiumContainer) {
    premiumContainer.addEventListener('click', (e) => {
      if (!ipu) {
        // Prevent event bubbling
        e.stopPropagation();
        window.open("https://tsurdan.github.io/Just-News/premium.html");
      }
    });
  }

  // Character mode selection
  characterModes.forEach(mode => {
    mode.addEventListener('click', () => {
      const clickedMode = mode.dataset.mode;
      
      // Check if free user trying to use premium mode
      if (!ipu && clickedMode !== 'robot') {
        // Redirect to premium purchase
        window.open("https://tsurdan.github.io/Just-News/premium.html");
        return;
      }

      // Save current prompts before switching
      saveCurrentPrompts();
      
      // Update current mode and selection state
      currentCharacterMode = clickedMode;
      
      // Update UI
      characterModes.forEach(m => {
        if (m.dataset.mode === clickedMode) {
          m.classList.add('selected');
        } else {
          m.classList.remove('selected');
        }
      });
      
      // Load prompts for the new mode
      loadPromptsForMode(currentCharacterMode);
      
      // Load prompts for selected character
      loadPromptsForMode(mode.dataset.mode);
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
    
    // Update character counters
    updateCharCounter(systemPrompt, systemPromptCounter, 1000);
    updateCharCounter(customPrompt, customPromptCounter, 800);
  }

  function updateCharacterModeUI() {
    characterModes.forEach(mode => {
      const isSelected = mode.dataset.mode === currentCharacterMode;
      
      // Handle selection state
      if (isSelected) {
        mode.classList.add('selected');
      } else {
        mode.classList.remove('selected');
      }
    });
    
    // Load prompts for the current mode
    loadPromptsForMode(currentCharacterMode);
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
    
    // Update API key link visibility
    updateApiKeyLink();
  }
  
  function updateApiKeyLink() {
    // Hide all links first
    groqLink.style.display = 'none';
    openaiLink.style.display = 'none';
    claudeLink.style.display = 'none';
    geminiLink.style.display = 'none';
    
    // Show the appropriate link based on selected provider
    const selectedValue = apiProvider.value;
    switch (selectedValue) {
      case 'groq':
        groqLink.style.display = 'inline';
        break;
      case 'openai':
        openaiLink.style.display = 'inline';
        break;
      case 'claude':
        claudeLink.style.display = 'inline';
        break;
      case 'gemini':
        geminiLink.style.display = 'inline';
        break;
    }
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
      modifiedPrompts: modifiedPrompts,
      preferedLang: preferedLang.value
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
        
        // Update character counters
        updateCharCounter(systemPrompt, systemPromptCounter, 1000);
        updateCharCounter(customPrompt, customPromptCounter, 800);
        
        status.textContent = 'Settings Reset!';
        status.style.color = '#4285F4';
        setTimeout(() => status.textContent = '', 2000);
      });
    }
  };

  // Premium button click handler
  const goPremiumBtn = document.getElementById('goPremiumBtn');
  if (goPremiumBtn) {
    goPremiumBtn.onclick = () => {
      window.open("https://tsurdan.github.io/Just-News/premium.html");
    };
  }
});