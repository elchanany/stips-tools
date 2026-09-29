// ============================================================
// Stips Reveal - Content Script
// Fetches and displays age, gender & extra data on stips.co.il
// ============================================================

(function () {
  'use strict';

  // ---- Configuration ----
  const CONFIG = {
    REQUEST_DELAY_MS: 200,
    MAX_CONCURRENT: 2,
    PROCESSED_ATTR: 'data-stips-reveal',
    BADGE_CLASS: 'stips-reveal-badge',
    WRAPPER_CLASS: 'stips-reveal-wrapper',
    INIT_DELAY_MS: 800,
  };

  // ---- Default settings ----
  const DEFAULT_SETTINGS = {
    enabled: true,
    displayMode: 'both',
    badgeSize: 11,
    maleColor: '#1565c0',
    maleBg: '#e3f2fd',
    femaleColor: '#c2185b',
    femaleBg: '#fce4ec',
    maleText: '',
    femaleText: '',
    
    inlineScore: false,
    inlineQuestions: false,
    inlineAnswers: false,
    inlineFlowers: false,
    inlineActiveSince: false,
    inlineNeeman: true,
    inlineMarked: true,   // Red X manual mark
    inlineBlocked: true,  // Auto 'חסמתי' badge
    
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

    // Page visibility
    pageHome: true,
    pagePenFriends: true,
    pageChat: true,
    pageQuestion: true,
    pageOther: true,
  };

  let currentSettings = { ...DEFAULT_SETTINGS };

  // ---- Marked users (manual Red X by double-click) ----
  let markedUsers = new Set(); // set of userIds (as strings)

  function loadMarkedUsers() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get('stipsMarkedUsers', r => {
          markedUsers = new Set(r.stipsMarkedUsers || []);
          resolve();
        });
      } else resolve();
    });
  }

  function saveMarkedUsers() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ stipsMarkedUsers: [...markedUsers] });
    }
  }

  function toggleMarkedUser(userId) {
    const id = String(userId);
    if (markedUsers.has(id)) {
      markedUsers.delete(id);
    } else {
      markedUsers.add(id);
    }
    saveMarkedUsers();
    // Rebuild all wrappers so the mark shows immediately
    rebuildAllWrappers();
    // Notify popup (so list stays in sync)
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'STIPS_MARKED_CHANGED', markedUsers: [...markedUsers] }).catch(() => {});
    }
  }

  // ---- Global Tooltip Elements ----
  let globalTooltip = null;
  let hideTooltipTimeout = null;

  // ---- Cache (Memory + LocalStorage) ----
  const cache = new Map();
  const CACHE_PREFIX = 'stips_rvl_';

  function getCacheTtl() {
    return (currentSettings.cacheTtlHours || 48) * 3600000;
  }

  function getFromCache(userId) {
    let data = cache.get(userId);
    const ttl = getCacheTtl();
    if (data && (Date.now() - data.timestamp < ttl)) return data;
    
    try {
      const storedStr = localStorage.getItem(CACHE_PREFIX + userId);
      if (storedStr) {
        const stored = JSON.parse(storedStr);
        if (Date.now() - stored.timestamp < ttl) {
          cache.set(userId, stored);
          return stored;
        } else {
          localStorage.removeItem(CACHE_PREFIX + userId);
        }
      }
    } catch (e) { /* Ignore */ }
    return null;
  }

  function saveToCache(userId, data) {
    cache.set(userId, data);
    try {
      localStorage.setItem(CACHE_PREFIX + userId, JSON.stringify(data));
    } catch (e) { /* Ignore */ }
  }

  // ---- Request queue ----
  const requestQueue = [];
  let activeRequests = 0;

  // ---- Gender helpers ----
  const GENDER = { MALE: 1, FEMALE: 2 };

  function genderLabel(g) {
    if (g === GENDER.MALE) return currentSettings.maleText || 'בן';
    if (g === GENDER.FEMALE) return currentSettings.femaleText || 'בת';
    return '?';
  }
  function genderClass(g) {
    if (g === GENDER.MALE) return 'stips-male';
    if (g === GENDER.FEMALE) return 'stips-female';
    return 'stips-unknown';
  }
  function genderIcon(g) {
    if (g === GENDER.MALE) return '♂';
    if (g === GENDER.FEMALE) return '♀';
    return '?';
  }

  // ---- Settings ----

  function loadSettings() {
    return new Promise(resolve => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get('stipsRevealSettings', r => {
          currentSettings = { ...DEFAULT_SETTINGS, ...(r.stipsRevealSettings || {}) };
          resolve(currentSettings);
        });
      } else resolve(currentSettings);
    });
  }

  function applySettingsCSS() {
    const root = document.documentElement;
    root.style.setProperty('--stips-badge-size', currentSettings.badgeSize + 'px');
    root.style.setProperty('--stips-male-color', currentSettings.maleColor);
    root.style.setProperty('--stips-male-bg', hexToRgba(currentSettings.maleBg, 0.3));
    root.style.setProperty('--stips-male-border', hexToRgba(currentSettings.maleColor, 0.3));
    root.style.setProperty('--stips-female-color', currentSettings.femaleColor);
    root.style.setProperty('--stips-female-bg', hexToRgba(currentSettings.femaleBg, 0.3));
    root.style.setProperty('--stips-female-border', hexToRgba(currentSettings.femaleColor, 0.25));
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Listen for settings changes from popup
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'STIPS_REVEAL_SETTINGS_CHANGED') {
        currentSettings = { ...DEFAULT_SETTINGS, ...msg.settings };
        applySettingsCSS();
        if (!currentSettings.enabled) {
          hideAllBadges();
        } else {
          showAllBadges();
          rebuildAllWrappers();
        }
      }
    });
  }

  function hideAllBadges() {
    document.querySelectorAll('.' + CONFIG.WRAPPER_CLASS).forEach(w => w.classList.add('stips-reveal-hidden'));
  }
  function showAllBadges() {
    document.querySelectorAll('.' + CONFIG.WRAPPER_CLASS).forEach(w => w.classList.remove('stips-reveal-hidden'));
  }

  function rebuildAllWrappers() {
    document.querySelectorAll('.' + CONFIG.WRAPPER_CLASS).forEach(wrapper => {
      const dataStr = wrapper.dataset.stipsData;
      if (!dataStr) return;
      try {
        const data = JSON.parse(dataStr);
        
        // Empty the wrapper but keep it in the DOM
        wrapper.innerHTML = '';
        
        // Clear any inline styles left over from previous auto-fits
        wrapper.style.removeProperty('--stips-badge-size');
        wrapper.style.removeProperty('gap');
        wrapper.style.removeProperty('max-height');
        wrapper.style.overflow = '';
        
        // Build new contents and move them over
        const newWrapper = buildBadgeWrapper(data);
        while (newWrapper.firstChild) {
          wrapper.appendChild(newWrapper.firstChild);
        }
        
        // Re-run autoFit wrapper logic
        const itemProfile = wrapper.closest('.item-profile');
        if (itemProfile) {
          const originalHeight = itemProfile.getBoundingClientRect().height; 
          requestAnimationFrame(() => autoFitWrapper(wrapper, originalHeight, itemProfile));
        }
      } catch (e) { /* ignore */ }
    });
  }

  // ---- API functions ----

  async function fetchProfilePageData(userId) {
    const params = JSON.stringify({ userid: userId });
    const url = `https://stips.co.il/api?name=profile.page_data&api_params=${encodeURIComponent(params)}`;
    const resp = await fetch(url, { credentials: 'include', priority: 'low' });
    if (!resp.ok) throw new Error(`profile.page_data error: ${resp.status}`);
    const json = await resp.json();
    return json?.data || {};
  }

  async function fetchOmniObj(userId) {
    const omniobj = JSON.stringify({ objType: 'user', data: { id: userId } });
    const url = `https://stips.co.il/api?name=omniobj&rest_action=GET&omniobj=${encodeURIComponent(omniobj)}`;
    const resp = await fetch(url, { credentials: 'include', priority: 'low' });
    if (!resp.ok) throw new Error(`omniobj error: ${resp.status}`);
    const json = await resp.json();
    return json?.data?.omniOmniObj?.data || {};
  }

  async function fetchBlockStatus(userId) {
    // messages.from_user returns userBlocked:true for users the logged-in user has blocked
    const params = JSON.stringify({ userid: userId, msgid: 0, first_load: true });
    const url = `https://stips.co.il/api?name=messages.from_user&api_params=${encodeURIComponent(params)}`;
    const resp = await fetch(url, { credentials: 'include', priority: 'low' });
    if (!resp.ok) return false;
    const json = await resp.json();
    return json?.data?.userBlocked === true;
  }

  async function getUserData(userId) {
    const cached = getFromCache(userId);
    if (cached) return cached;

    const [profileData, omniData, isBlocked] = await Promise.all([
      fetchProfilePageData(userId).catch(() => ({})),
      fetchOmniObj(userId).catch(() => ({})),
      (currentSettings.inlineBlocked || currentSettings.tooltipBlocked) 
        ? fetchBlockStatus(userId).catch(() => false) 
        : Promise.resolve(false)
    ]);

    const data = {
      id: userId,
      age: profileData.age ?? null,
      gender: omniData.gender ?? null,
      score: omniData.points ?? null,
      questions: profileData.questions ?? null,
      answers: profileData.answers ?? null,
      flowers: profileData.flowers ?? null,
      activeSince: profileData.hebrew_active_since ?? null,
      status: profileData.user_profile_page?.data?.text_status ?? null,
      nickname: omniData.nickname ?? null,
      isNeeman: Array.isArray(profileData.badges) ? profileData.badges.some(b => b.name === 'moderator') : false,
      isBlocked,
      timestamp: Date.now(),
    };

    saveToCache(userId, data);
    return data;
  }

  // ---- Queue management ----

  function enqueueRequest(userId, callback) {
    const cached = getFromCache(userId);
    if (cached) {
      callback(cached);
      return;
    }
    const existing = requestQueue.find(r => r.userId === userId);
    if (existing) {
      existing.callbacks.push(callback);
      return;
    }
    requestQueue.push({ userId, callbacks: [callback] });
    processQueue();
  }

  async function processQueue() {
    if (activeRequests >= CONFIG.MAX_CONCURRENT || requestQueue.length === 0) return;
    activeRequests++;
    const { userId, callbacks } = requestQueue.shift();
    try {
      const data = await getUserData(userId);
      callbacks.forEach(cb => cb(data));
    } catch (err) {
      console.warn(`[Stips Reveal] Error fetching user ${userId}:`, err);
    } finally {
      activeRequests--;
      setTimeout(() => processQueue(), CONFIG.REQUEST_DELAY_MS);
    }
  }

  // ---- Global Tooltip ----
  function initGlobalTooltip() {
    if (!document.getElementById('stips-reveal-global-tooltip')) {
      globalTooltip = document.createElement('div');
      globalTooltip.id = 'stips-reveal-global-tooltip';
      document.body.appendChild(globalTooltip);

      // Keep tooltip visible if mouse moves over it
      globalTooltip.addEventListener('mouseenter', () => {
        if (hideTooltipTimeout) clearTimeout(hideTooltipTimeout);
      });
      globalTooltip.addEventListener('mouseleave', () => {
        hideGlobalTooltip();
      });
    }
  }

  function showGlobalTooltip(anchorEl, userId) {
    if (!currentSettings.enabled || !currentSettings.tooltipEnabled || !globalTooltip) return;
    if (hideTooltipTimeout) clearTimeout(hideTooltipTimeout);

    const data = cache.get(userId);
    if (!data) return;

    // Check if there is anything to show
    const s = currentSettings;
    const hasDataRow = (s.tooltipAgeGender && (data.age!=null || data.gender!=null)) ||
                       (s.tooltipScore && data.score!=null) ||
                       (s.tooltipQuestions && data.questions!=null) ||
                       (s.tooltipAnswers && data.answers!=null) ||
                       (s.tooltipFlowers && data.flowers!=null) ||
                       (s.tooltipActiveSince && data.activeSince);
    const hasBio = s.tooltipBio && data.status;

    if (!hasDataRow && !hasBio) {
      globalTooltip.classList.remove('stips-tooltip-visible');
      return;
    }

    // Build Tooltip HTML
    let html = '';
    
    if (hasDataRow) {
      if (s.tooltipAgeGender && data.gender != null) {
        const gColor = data.gender === GENDER.MALE ? 'var(--stips-male-color, #1565c0)' : 'var(--stips-female-color, #c2185b)';
        html += `<div class="tooltip-row"><span class="tooltip-icon">${data.gender === GENDER.MALE ? '♂' : '♀'}</span><span class="tooltip-label">מגדר</span><span class="tooltip-value" style="color: ${gColor}; background: rgba(255,255,255,0.9); padding: 0 4px; border-radius: 4px;">${genderLabel(data.gender)}</span></div>`;
      }
      if (s.tooltipAgeGender && data.age != null) {
        html += `<div class="tooltip-row"><span class="tooltip-icon">🎂</span><span class="tooltip-label">גיל</span><span class="tooltip-value">${data.age}</span></div>`;
      }
      if (s.tooltipScore && data.score != null) {
        html += `<div class="tooltip-row"><span class="tooltip-icon">🏆</span><span class="tooltip-label">דירוג</span><span class="tooltip-value">${data.score}</span></div>`;
      }
      if (s.tooltipQuestions && data.questions != null) {
        html += `<div class="tooltip-row"><span class="tooltip-icon">❓</span><span class="tooltip-label">שאלות</span><span class="tooltip-value">${data.questions}</span></div>`;
      }
      if (s.tooltipAnswers && data.answers != null) {
        html += `<div class="tooltip-row"><span class="tooltip-icon">💬</span><span class="tooltip-label">תשובות</span><span class="tooltip-value">${data.answers}</span></div>`;
      }
      if (s.tooltipFlowers && data.flowers != null) {
        html += `<div class="tooltip-row"><span class="tooltip-icon">🌸</span><span class="tooltip-label">פרחים</span><span class="tooltip-value">${data.flowers}</span></div>`;
      }
      if (s.tooltipActiveSince && data.activeSince) {
        html += `<div class="tooltip-row"><span class="tooltip-icon">⏱️</span><span class="tooltip-label">פעילות</span><span class="tooltip-value">${data.activeSince}</span></div>`;
      }
    }

    if (hasBio) {
      html += `<div class="tooltip-bio">${data.status}</div>`;
    }

    globalTooltip.innerHTML = html;

    // Position tooltip relative to hovered element
    const rect = anchorEl.getBoundingClientRect();
    const tooltipWidth = globalTooltip.offsetWidth || 200; // rough default for first paint
    
    // Position below the element
    let top = rect.bottom + window.scrollY + 6;
    let right = (window.innerWidth - rect.right) - window.scrollX;

    // Optional: make sure it doesn't clip off left/right
    globalTooltip.style.top = top + 'px';
    globalTooltip.style.right = right + 'px';
    globalTooltip.style.left = 'auto'; // ensure rtl is respected correctly

    globalTooltip.classList.add('stips-tooltip-visible');
  }

  function hideGlobalTooltip() {
    hideTooltipTimeout = setTimeout(() => {
      if (globalTooltip) {
        globalTooltip.classList.remove('stips-tooltip-visible');
      }
    }, 150); // slight delay allowing mouse to move to tooltip
  }

  // ---- Badge / wrapper creation ----

  function buildBadgeWrapper(data) {
    const wrapper = document.createElement('span');
    wrapper.className = CONFIG.WRAPPER_CLASS;
    // Store data for live rebuild on settings change
    wrapper.dataset.stipsData = JSON.stringify(data);

    if (!currentSettings.enabled) {
      wrapper.classList.add('stips-reveal-hidden');
    }

    // 1. Main badge (gender + age)
    if (data.age != null || data.gender != null) {
      const badge = document.createElement('span');
      badge.className = `${CONFIG.BADGE_CLASS} ${genderClass(data.gender)}`;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'stips-gender-icon';
      const textSpan = document.createElement('span');
      textSpan.className = 'stips-age-text';

      const mode = currentSettings.displayMode;
      const label = genderLabel(data.gender);

      if (mode === 'both') {
        iconSpan.textContent = genderIcon(data.gender);
        textSpan.textContent = data.age != null ? `${label} ${data.age}` : label;
      } else if (mode === 'age') {
        iconSpan.style.display = 'none';
        textSpan.textContent = data.age != null ? String(data.age) : '?';
      } else if (mode === 'gender') {
        iconSpan.textContent = genderIcon(data.gender);
        textSpan.textContent = label;
      }

      badge.appendChild(iconSpan);
      badge.appendChild(textSpan);
      wrapper.appendChild(badge);
    }

    // Prominent Ne'eman Badge
    if (currentSettings.inlineNeeman && data.isNeeman) {
      const neemanBadge = document.createElement('span');
      neemanBadge.className = `stips-reveal-badge stips-neeman`;
      const neemanText = data.gender === GENDER.FEMALE ? 'נאמנת סטיפס' : 'נאמן סטיפס';
      neemanBadge.innerHTML = `<span class="stips-gender-icon">🛡️</span><span class="stips-age-text">${neemanText}</span>`;
      wrapper.appendChild(neemanBadge);
    }

    // Extra inline tags
    if (currentSettings.inlineScore && data.score != null) wrapper.appendChild(makeExtraBadge('\uD83C\uDFC6', data.score, 'stips-score'));
    if (currentSettings.inlineQuestions && data.questions != null) wrapper.appendChild(makeExtraBadge('\u2753', data.questions, 'stips-questions'));
    if (currentSettings.inlineAnswers && data.answers != null) wrapper.appendChild(makeExtraBadge('\uD83D\uDCAC', data.answers, 'stips-answers'));
    if (currentSettings.inlineFlowers && data.flowers != null) wrapper.appendChild(makeExtraBadge('\uD83C\uDF38', data.flowers, 'stips-flowers'));
    if (currentSettings.inlineActiveSince && data.activeSince) wrapper.appendChild(makeExtraBadge('\u23F1\uFE0F', data.activeSince, 'stips-active-since'));

    // Blocked badge (automatic - detected from API)
    if (currentSettings.inlineBlocked && data.isBlocked) {
      wrapper.appendChild(makeExtraBadge('\uD83D\uDEAB', '\u05D7\u05E1\u05DE\u05EA\u05D9', 'stips-blocked'));
    }

    // Marked badge (manual red X - double-click on any badge)
    const isMarked = markedUsers.has(String(data.id));
    if (currentSettings.inlineMarked && isMarked) {
      const markedBadge = document.createElement('span');
      markedBadge.className = 'stips-reveal-badge stips-marked';
      markedBadge.innerHTML = `<span class="stips-gender-icon">\u274C</span><span class="stips-age-text">\u05DE\u05E1\u05D5\u05DE\u05DF</span>`;
      wrapper.appendChild(markedBadge);
    }

    return wrapper;
  }

  function makeExtraBadge(icon, value, cssClass) {
    const badge = document.createElement('span');
    badge.className = `stips-reveal-extra ${cssClass}`;
    badge.innerHTML = `<span>${icon}</span><span>${value}</span>`;
    return badge;
  }

  // ---- User ID extraction ----

  function extractUserId(href) {
    if (!href) return null;
    const match = href.match(/\/(?:profile|messages)\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  // ---- Hover setup ----
  // Attach enter/leave to the profile link, so hover works specifically on the image/name
  function attachHoverListeners(element, userId) {
    if (element.hasAttribute('data-stips-hover')) return; // already attached
    element.setAttribute('data-stips-hover', 'true');
    element.addEventListener('mouseenter', () => showGlobalTooltip(element, userId));
    element.addEventListener('mouseleave', hideGlobalTooltip);
  }

  // ---- DOM processing ----

  function injectWrapper(targetEl, data, position = 'append') {
    const wrapper = buildBadgeWrapper(data);
    
    // Double-click on wrapper = toggle marked user
    wrapper.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMarkedUser(data.id);
    });

    // Measure the container's height BEFORE injection (only for item-profile contexts)
    const itemProfileContainer = targetEl.closest('.item-profile');
    const heightBefore = itemProfileContainer ? itemProfileContainer.getBoundingClientRect().height : 0;
    
    if (position === 'append') {
      targetEl.appendChild(wrapper);
    } else if (position === 'after') {
      targetEl.after(wrapper);
    }
    
    // Auto-fit: only shrink badges in .item-profile cards (pen-friends/home)
    // For chat list and other contexts, just clip with overflow hidden
    if (itemProfileContainer) {
      requestAnimationFrame(() => autoFitWrapper(wrapper, heightBefore, itemProfileContainer));
    } else {
      // For chat list and other contexts: just ensure no overflow, no size change
      requestAnimationFrame(() => {
        wrapper.style.overflow = 'hidden';
      });
    }
    return wrapper;
  }

  function autoFitWrapper(wrapper, originalHeight, container) {
    if (!wrapper || !container) return;
    
    let currentSize = parseFloat(getComputedStyle(wrapper).getPropertyValue('--stips-badge-size')) || 11;
    const minSize = 7;
    
    // Check if our badges caused the .item-profile card to grow beyond its original height
    let attempts = 0;
    while (attempts < 10 && currentSize > minSize) {
      const currentHeight = container.getBoundingClientRect().height;
      // If the container is at or below its original height, badges fit on one row
      if (currentHeight <= originalHeight + 2) break;
      
      // Shrink badge size to try to fit them in one row
      currentSize -= 0.5;
      wrapper.style.setProperty('--stips-badge-size', currentSize + 'px');
      wrapper.style.gap = Math.max(2, Math.round(currentSize * 0.3)) + 'px';
      attempts++;
    }
    
    // After best-fit, we allow the container to stay expanded (height: auto handles this)
    // Just clip the wrapper itself if anything still sticks out
    wrapper.style.overflow = 'hidden';
  }

  function processItemProfiles(root) {
    const items = root.querySelectorAll('.item-profile:not([' + CONFIG.PROCESSED_ATTR + '])');
    items.forEach(item => {
      const profileLink = item.querySelector('a.profile_link');
      if (!profileLink) return;
      const userId = extractUserId(profileLink.getAttribute('href'));
      if (!userId) return;
      item.setAttribute(CONFIG.PROCESSED_ATTR, 'pending');

      attachHoverListeners(profileLink, userId);

      enqueueRequest(userId, data => {
        // Append directly to the outer item-profile flex container. 
        // Since Stips uses RTL flex row, this automatically places it in the empty space on the left.
        injectWrapper(item, data, 'append');
        item.setAttribute(CONFIG.PROCESSED_ATTR, 'done');
      });
    });
  }

  function processMessageList(root) {
    const messages = root.querySelectorAll('a.list-message:not([' + CONFIG.PROCESSED_ATTR + '])');
    messages.forEach(msgEl => {
      const userId = extractUserId(msgEl.getAttribute('href'));
      if (!userId) return;
      msgEl.setAttribute(CONFIG.PROCESSED_ATTR, 'pending');

      attachHoverListeners(msgEl, userId);

      enqueueRequest(userId, data => {
        // Same as profile items, append to the main message flex row container
        injectWrapper(msgEl, data, 'append');
        msgEl.setAttribute(CONFIG.PROCESSED_ATTR, 'done');
      });
    });
  }

  function processChatHeader(root) {
    const chatHeaders = root.querySelectorAll(
      '.chat-header:not([' + CONFIG.PROCESSED_ATTR + ']), ' +
      '.message-header:not([' + CONFIG.PROCESSED_ATTR + ']), ' +
      'app-message-header:not([' + CONFIG.PROCESSED_ATTR + '])'
    );

    chatHeaders.forEach(header => {
      const profileLink = header.querySelector('a[href*="/profile/"]');
      if (!profileLink) return;
      const userId = extractUserId(profileLink.getAttribute('href'));
      if (!userId) return;
      header.setAttribute(CONFIG.PROCESSED_ATTR, 'pending');

      attachHoverListeners(profileLink, userId);

      enqueueRequest(userId, data => {
        const nameEl = header.querySelector('.nickname, .name, .user-name') || profileLink;
        if (nameEl) injectWrapper(nameEl, data, 'after');
        header.setAttribute(CONFIG.PROCESSED_ATTR, 'done');
      });
    });
  }

  function processCatchAll(root) {
    const profileLinks = root.querySelectorAll(
      'a[href*="/profile/"]:not([' + CONFIG.PROCESSED_ATTR + '-link])'
    );
    profileLinks.forEach(link => {
      if (link.closest('[' + CONFIG.PROCESSED_ATTR + ']')) return;
      if (link.querySelector('app-profile-avatar, img') && !link.querySelector('.name, .nickname')) return;
      
      const userId = extractUserId(link.getAttribute('href'));
      if (!userId) return;
      const parent = link.parentElement;
      if (!parent) return;
      link.setAttribute(CONFIG.PROCESSED_ATTR + '-link', 'pending');

      attachHoverListeners(link, userId);

      enqueueRequest(userId, data => {
        injectWrapper(link, data, 'after');
        link.setAttribute(CONFIG.PROCESSED_ATTR + '-link', 'done');
      });
    });
  }

  function getPageType() {
    const path = location.pathname;
    if (path === '/' || path === '/home' || path.startsWith('/new') || path.startsWith('/hot') || path.startsWith('/top')) return 'home';
    if (path.startsWith('/pen-friends')) return 'pagePenFriends';
    if (path.startsWith('/messages')) return 'pageChat';
    if (path.startsWith('/ask/') || path.startsWith('/question/')) return 'pageQuestion';
    return 'pageOther';
  }

  function isPageEnabled() {
    const pageType = getPageType();
    // 'home' maps to pageHome setting
    const settingKey = pageType === 'home' ? 'pageHome' : pageType;
    return currentSettings[settingKey] !== false; // Default true if not set
  }

  function scanPage() {
    const root = document.body;
    if (!root) return;
    if (!isPageEnabled()) return; // Skip if this page type is disabled
    processItemProfiles(root);
    processMessageList(root);
    processChatHeader(root);
    processCatchAll(root);
  }

  // ---- MutationObserver ----

  let scanTimeout = null;
  function debouncedScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => scanPage(), 300);
  }

  const observer = new MutationObserver(mutations => {
    let shouldScan = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (
            node.classList?.contains('item-profile') ||
            node.classList?.contains('list-message') ||
            node.querySelector?.('.item-profile, .list-message, a[href*="/profile/"]')
          ) {
            shouldScan = true;
            break;
          }
        }
      }
      if (shouldScan) break;
    }
    if (shouldScan) debouncedScan();
  });

  // ---- URL change detection ----

  let lastUrl = location.href;
  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => scanPage(), 500);
    }
  }
  setInterval(checkUrlChange, 500);
  window.addEventListener('popstate', () => setTimeout(() => scanPage(), 500));

  // ---- Initialization ----

  function scheduleIdle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fn);
    else setTimeout(fn, 50);
  }

  function startScanning() {
    console.log('[Stips Reveal] Starting badge scans');
    initGlobalTooltip();
    applySettingsCSS();
    scheduleIdle(() => scanPage());
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => scheduleIdle(() => scanPage()), 3000);
    setTimeout(() => scheduleIdle(() => scanPage()), 7000);
  }

  async function init() {
    console.log('[Stips Reveal] Extension loaded');
    await Promise.all([loadSettings(), loadMarkedUsers()]);
    if (document.readyState === 'complete') {
      setTimeout(startScanning, CONFIG.INIT_DELAY_MS);
    } else {
      window.addEventListener('load', () => setTimeout(startScanning, CONFIG.INIT_DELAY_MS));
    }

    // ---- Live settings updates via storage listener ----
    // chrome.storage.onChanged fires reliably whenever the popup saves settings.
    // The main 'enabled' toggle intentionally requires a page reload.
    // All other settings (size, colors, badges, page visibility) apply instantly.
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.stipsRevealSettings) return;

        const newSettings = changes.stipsRevealSettings.newValue || {};
        const merged = { ...DEFAULT_SETTINGS, ...newSettings };

        // If 'enabled' changed, skip live update - requires page reload
        if (merged.enabled !== currentSettings.enabled) return;

        const prevPageEnabled = isPageEnabled();
        currentSettings = merged;
        const nowPageEnabled = isPageEnabled();

        // Apply CSS variables (colors, size) immediately
        applySettingsCSS();

        // Show/hide existing wrappers based on page visibility
        const allWrappers = document.querySelectorAll('.' + CONFIG.WRAPPER_CLASS);
        
        if (!nowPageEnabled) {
          // If page was disabled, hide all wrappers
          allWrappers.forEach(w => w.style.display = 'none');
        } else {
          // If page is enabled, we need to completely rebuild the badges to reflect new individual toggles
          allWrappers.forEach(w => w.style.display = ''); // ensure they are visible
          rebuildAllWrappers(); // Safely rebuilds inner badges from dataset.stipsData
          
          // Re-scan incase there are unprocessed items
          setTimeout(() => scanPage(), 100);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
