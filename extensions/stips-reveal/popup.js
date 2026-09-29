// ============================================================
// Stips Reveal - Popup Script
// Settings management for the Chrome extension
// ============================================================

const DEFAULT_SETTINGS = {
  enabled: true,
  displayMode: 'both',    // 'both', 'age', 'gender'
  badgeSize: 11,
  maleColor: '#1565c0',
  maleBg: '#e3f2fd',
  femaleColor: '#c2185b',
  femaleBg: '#fce4ec',
  maleText: '',            // Empty = default (בן)
  femaleText: '',          // Empty = default (בת)
  
  // INLINE BADGES
  inlineScore: false,
  inlineQuestions: false,
  inlineAnswers: false,
  inlineFlowers: false,
  inlineActiveSince: false,
  inlineNeeman: true,
  inlineMarked: true,
  inlineBlocked: true,
  
  // TOOLTIP
  tooltipEnabled: true,
  tooltipAgeGender: true,
  tooltipScore: false,
  tooltipQuestions: false,
  tooltipAnswers: false,
  tooltipFlowers: false,
  tooltipActiveSince: false,
  tooltipNeeman: true,
  tooltipMarked: true,
  tooltipBlocked: true,
  tooltipBio: true,
  
  cacheTtlHours: 48,

  // PAGE VISIBILITY - which pages show badges
  pageHome: true,          // עמוד הבית (feed)
  pagePenFriends: true,    // חברים לעט
  pageChat: true,          // צ'אטים (רשימות שיחות)
  pageQuestion: true,      // עמוד שאלה
  pageOther: true,         // כל שאר העמודים
};

// Checkbox mapping
const CHECKBOX_IDS = [
  'enabled',
  'inlineScore', 'inlineQuestions', 'inlineAnswers', 'inlineFlowers', 'inlineActiveSince', 'inlineNeeman', 'inlineMarked', 'inlineBlocked',
  'tooltipEnabled', 'tooltipAgeGender', 'tooltipScore', 'tooltipQuestions', 'tooltipAnswers', 'tooltipFlowers', 'tooltipActiveSince', 'tooltipNeeman', 'tooltipMarked', 'tooltipBlocked', 'tooltipBio',
  'pageHome', 'pagePenFriends', 'pageChat', 'pageQuestion', 'pageOther',
];

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('stipsRevealSettings', (result) => {
      const settings = { ...DEFAULT_SETTINGS, ...(result.stipsRevealSettings || {}) };
      resolve(settings);
    });
  });
}

function saveSettings(settings) {
  chrome.storage.local.set({ stipsRevealSettings: settings }, () => {
    chrome.tabs.query({ url: '*://stips.co.il/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'STIPS_REVEAL_SETTINGS_CHANGED',
          settings: settings,
        }).catch(() => {});
      });
    });
  });
}

function applyToUI(settings) {
  CHECKBOX_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[id];
  });

  document.querySelectorAll('input[name="displayMode"]').forEach(radio => {
    radio.checked = radio.value === settings.displayMode;
  });

  document.getElementById('badgeSize').value = settings.badgeSize;
  document.getElementById('sizeValue').textContent = settings.badgeSize + 'px';

  document.getElementById('maleColor').value = settings.maleColor;
  document.getElementById('maleBg').value = settings.maleBg;
  document.getElementById('femaleColor').value = settings.femaleColor;
  document.getElementById('femaleBg').value = settings.femaleBg;

  document.getElementById('maleText').value = settings.maleText;
  document.getElementById('femaleText').value = settings.femaleText;

  const cacheTtlSelect = document.getElementById('cacheTtlSelect');
  if (cacheTtlSelect && settings.cacheTtlHours) {
    cacheTtlSelect.value = settings.cacheTtlHours;
  }
}

function readFromUI() {
  const displayMode = document.querySelector('input[name="displayMode"]:checked')?.value || 'both';
  
  const settings = {
    displayMode,
    badgeSize: parseInt(document.getElementById('badgeSize').value),
    maleColor: document.getElementById('maleColor').value,
    maleBg: document.getElementById('maleBg').value,
    femaleColor: document.getElementById('femaleColor').value,
    femaleBg: document.getElementById('femaleBg').value,
    maleText: document.getElementById('maleText').value.trim(),
    femaleText: document.getElementById('femaleText').value.trim(),
  };

  const cacheTtlSelect = document.getElementById('cacheTtlSelect');
  if (cacheTtlSelect) {
    settings.cacheTtlHours = parseInt(cacheTtlSelect.value, 10);
  }

  CHECKBOX_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) settings[id] = el.checked;
  });

  return settings;
}

async function init() {
  const settings = await loadSettings();
  applyToUI(settings);

  // Auto-save on any change
  const inputs = document.querySelectorAll('input');
  inputs.forEach(input => {
    const event = (input.type === 'text' || input.type === 'range' || input.type === 'color') ? 'input' : 'change';
    input.addEventListener(event, () => {
      const newSettings = readFromUI();
      saveSettings(newSettings);

      if (input.id === 'badgeSize') {
        document.getElementById('sizeValue').textContent = input.value + 'px';
      }
    });
  });

  // Handle select elements for auto-save
  const selects = document.querySelectorAll('select');
  selects.forEach(select => {
    select.addEventListener('change', () => {
      const newSettings = readFromUI();
      saveSettings(newSettings);
    });
  });

  // Advanced toggle
  const advancedToggle = document.getElementById('advancedToggle');
  const advancedPanel = document.getElementById('advancedPanel');
  const advancedArrow = document.getElementById('advancedArrow');

  advancedToggle.addEventListener('click', () => {
    advancedPanel.classList.toggle('open');
    advancedArrow.classList.toggle('open');
  });

  // Help modal logic
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const helpClose = document.getElementById('helpClose');

  if (helpBtn && helpModal && helpClose) {
    helpBtn.addEventListener('click', () => {
      helpModal.classList.add('open');
    });

    helpClose.addEventListener('click', () => {
      helpModal.classList.remove('open');
    });

    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.classList.remove('open');
      }
    });
  }

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', () => {
    applyToUI(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
  });
}

document.addEventListener('DOMContentLoaded', init);
