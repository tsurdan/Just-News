document.addEventListener('DOMContentLoaded', () => {
  const systemPrompt = document.getElementById('systemPrompt');
  const customPrompt = document.getElementById('customPrompt');
  const saveBtn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const resetBtn = document.getElementById('resetBtn');
  const status = document.getElementById('status');
  const characterModes = document.querySelectorAll('.character-mode');
  const preferedLang = document.getElementById('preferedLang');
  const customPromptsSection = document.getElementById('customPromptsSection');
  const premiumContainer = document.getElementById('premiumContainer');
  const autoReplaceCheckbox = document.getElementById('autoReplaceHeadlines');

  const systemPromptCounter = document.getElementById('systemPromptCounter');
  const customPromptCounter = document.getElementById('customPromptCounter');

  const characterConfigs = {
    robot: {
      systemPrompt: "Generate an objective, non-clickbait headline for a given article. Keep it robotic, purely informative, and in the article's language. Match the original title's length. If the original title asks a question, provide a direct answer. The goal is for the user to understand the article's main takeaway without needing to read it.",
      userPrompt: "Rewrite the headline, based on the article, with these rules:\n\n- Robotic, factual, no clickbait\n- Summarize the key point of the article\n- Be objective and informative\n Keep the original headline length and language"
    },
    clean: {
      systemPrompt: "You are a guardian of ethical and family-friendly speech according to Jewish laws of Lashon Hara (evil speech). You rewrite headlines to remove gossip, slander, negativity about individuals, harmful speech, profanity, swear words, violence, sexual content, and any content inappropriate for all ages. Focus on constructive, respectful, and clean language that avoids speaking negatively about people.",
      userPrompt: "Rewrite this headline according to Jewish laws against Lashon Hara (evil speech) and remove all inappropriate content. Remove:\n- Gossip, slander, or negative speech about individuals\n- Profanity and swear words\n- Violent or graphic descriptions\n- Sexual content or references\n- Any content not suitable for all ages\n\nFocus only on essential facts presented respectfully and appropriately. If the article contains only inappropriate content with no constructive value, note that it violates speech ethics.\n\nYour answer must be in the original headline length and in the article language."
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
      systemPrompt: "You are a media manipulator detector. You never summarize the article or react to its content. Instead, you rewrite the headline to expose what the article is trying to make the reader feel, believe, or do. Your new headline should say: What the article is trying to achieve, what emotion or belief it wants to plant, who benefits from it. Use a short and blunt style.",
      userPrompt: "What is this article trying to make people feel, believe, or do? Your answer must be in the original headline length and in the article language."
    },
    custom: {
      systemPrompt: "",
      userPrompt: ""
    }
  };

  let currentCharacterMode = 'robot';
  let isPremium = false;
  let modifiedPrompts = {};

  function updateCharCounter(textarea, counter, maxLength) {
    const currentLength = textarea.value.length;
    counter.textContent = `${currentLength}/${maxLength}`;

    counter.classList.remove('warning', 'danger');
    if (currentLength > maxLength * 0.9) {
      counter.classList.add('danger');
    } else if (currentLength > maxLength * 0.75) {
      counter.classList.add('warning');
    }
  }

  if (systemPrompt) {
    systemPrompt.addEventListener('input', () => {
      updateCharCounter(systemPrompt, systemPromptCounter, 1000);
    });
  }

  if (customPrompt) {
    customPrompt.addEventListener('input', () => {
      updateCharCounter(customPrompt, customPromptCounter, 800);
    });
  }

  chrome.storage.sync.get(['characterMode', 'systemPrompt', 'customPrompt', 'modifiedPrompts', 'preferedLang', 'autoReplaceHeadlines'], (data) => {
    chrome.storage.local.get(['access_jwt'], (localData) => {
      let premium = false;
      if (localData.access_jwt) {
        try {
          const payload = localData.access_jwt.split('.')[1];
          const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
          premium = !!decoded.premium;
        } catch (e) {
          premium = false;
        }
      }
      isPremium = premium;
      updatePremiumUI(isPremium);
      if (data.preferedLang) {
        preferedLang.value = data.preferedLang;
      } else {
        preferedLang.value = 'english';
      }

      currentCharacterMode = data.characterMode || 'robot';

      if (data.modifiedPrompts) {
        modifiedPrompts = data.modifiedPrompts;
      }

      updateCharacterModeUI();
      loadPromptsForMode(currentCharacterMode);
      if (autoReplaceCheckbox) {
        autoReplaceCheckbox.checked = (typeof data.autoReplaceHeadlines === 'boolean') ? data.autoReplaceHeadlines : true;
      }
    })
  });

  function updatePremiumUI(premium) {
    if (premium) {
      document.body.classList.add('premium-unlocked');
      if (customPromptsSection) {
        customPromptsSection.style.display = 'block';
      }
    } else {
      document.body.classList.remove('premium-unlocked');
      if (customPromptsSection) {
        customPromptsSection.style.display = 'none';
      }
    }
  }

  if (premiumContainer) {
    premiumContainer.addEventListener('click', (e) => {
      if (!isPremium && e.target === premiumContainer) {
        e.stopPropagation();
        window.open("https://tsurdan.github.io/Just-News/premium.html");
      }
    });
  }

  characterModes.forEach(mode => {
    mode.addEventListener('click', (e) => {
      e.stopPropagation();

      const clickedMode = mode.dataset.mode;
      const isPremiumMode = !['robot', 'clean'].includes(clickedMode);

      if (!isPremium && isPremiumMode) {
        window.open("https://tsurdan.github.io/Just-News/premium.html");
        return;
      }

      if (isPremium) {
        saveCurrentPrompts();
      }

      currentCharacterMode = clickedMode;
      updateCharacterModeUI();
      loadPromptsForMode(currentCharacterMode);
    });
  });

  function saveCurrentPrompts() {
    if (!isPremium) return;

    modifiedPrompts[currentCharacterMode] = {
      systemPrompt: systemPrompt ? systemPrompt.value : '',
      userPrompt: customPrompt ? customPrompt.value : ''
    };

    chrome.storage.sync.set({ modifiedPrompts: modifiedPrompts });
  }

  function loadPromptsForMode(mode) {
    if (!isPremium) {
      // For free users, still update storage with the mode's default prompts
      const config = characterConfigs[mode];
      chrome.storage.sync.set({
        systemPrompt: config.systemPrompt,
        customPrompt: config.userPrompt
      });
      return;
    }

    if (modifiedPrompts[mode]) {
      if (systemPrompt) systemPrompt.value = modifiedPrompts[mode].systemPrompt;
      if (customPrompt) customPrompt.value = modifiedPrompts[mode].userPrompt;
    } else {
      const config = characterConfigs[mode];
      if (systemPrompt) systemPrompt.value = config.systemPrompt;
      if (customPrompt) customPrompt.value = config.userPrompt;
    }

    if (systemPrompt && systemPromptCounter) {
      updateCharCounter(systemPrompt, systemPromptCounter, 1000);
    }
    if (customPrompt && customPromptCounter) {
      updateCharCounter(customPrompt, customPromptCounter, 800);
    }
  }

  function updateCharacterModeUI() {
    characterModes.forEach(mode => {
      const modeType = mode.dataset.mode;
      const isSelected = modeType === currentCharacterMode;

      if (isSelected) {
        mode.classList.add('selected');
      } else {
        mode.classList.remove('selected');
      }
    });
  }

  saveBtn.onclick = () => {
    const dataToSave = {
      characterMode: currentCharacterMode,
      preferedLang: preferedLang.value,
      autoReplaceHeadlines: autoReplaceCheckbox ? autoReplaceCheckbox.checked : true
    };

    if (isPremium) {
      saveCurrentPrompts();

      if (currentCharacterMode === 'custom') {
        const systemPromptValue = systemPrompt ? systemPrompt.value.trim() : '';
        const customPromptValue = customPrompt ? customPrompt.value.trim() : '';

        if (systemPromptValue === '' || customPromptValue === '') {
          status.textContent = 'Custom mode requires both prompts!';
          status.style.color = '#dc3545';
          setTimeout(() => {
            status.textContent = '';
            status.style.color = '#4285F4';
          }, 3000);
          return;
        }
      }

      dataToSave.systemPrompt = systemPrompt ? systemPrompt.value : '';
      dataToSave.customPrompt = customPrompt ? customPrompt.value : '';
      dataToSave.modifiedPrompts = modifiedPrompts;
    } else {
      // For free users, save the default prompts for their selected mode
      const config = characterConfigs[currentCharacterMode];
      dataToSave.systemPrompt = config.systemPrompt;
      dataToSave.customPrompt = config.userPrompt;
    }

    chrome.storage.sync.set(dataToSave, () => {
      status.textContent = 'Saved!';
      status.style.color = '#4285F4';
      setTimeout(() => status.textContent = '', 1500);
    });
  };

  cancelBtn.onclick = () => {
    if (isPremium) {
      saveCurrentPrompts();
    }
    window.close();
  };

  window.addEventListener('beforeunload', () => {
    if (isPremium) {
      saveCurrentPrompts();
    }
  });

  resetBtn.onclick = () => {
    if (confirm('Are you sure you want to reset all settings? This will clear all custom prompts and preferences.')) {
      currentCharacterMode = 'robot';
      updateCharacterModeUI();

      if (isPremium && systemPrompt && customPrompt) {
        systemPrompt.value = characterConfigs.robot.systemPrompt;
        customPrompt.value = characterConfigs.robot.userPrompt;
        modifiedPrompts = {};
        updateCharCounter(systemPrompt, systemPromptCounter, 1000);
        updateCharCounter(customPrompt, customPromptCounter, 800);
      }

      preferedLang.value = 'english';
      if (autoReplaceCheckbox) autoReplaceCheckbox.checked = true;

      status.textContent = 'Settings Reset!';
      status.style.color = '#4285F4';
      setTimeout(() => status.textContent = '', 2000);
    }
  };
});