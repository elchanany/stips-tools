/**
 * Stips Download - Content Script
 * Seamless turquoise chat header injection inside .messages-toolbar mat-toolbar,
 * inbox row injection on a.list-message, pen-friends card injection on .item-card,
 * and zero interference with question pages or navigation bars.
 */

(() => {
  // Prevent double injection
  if (window.__STIPS_DOWNLOAD_INITIALIZED__) return;
  window.__STIPS_DOWNLOAD_INITIALIZED__ = true;

  console.log('🚀 Stips Download Content Script Loaded');

  // State
  let currentPartnerId = null;
  let currentPartnerName = null;
  let myProfileInfo = { myName: 'אתה', myId: null };

  let activeAbortController = null;
  let isPaused = false;
  let shadowRoot = null;
  let modalContainer = null;
  let modalDOMElements = null;

  // Download Icon SVG
  const DOWNLOAD_ICON_SVG = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  // 1. Detect Logged-In User Profile ("אתה")
  function detectMyProfile() {
    try {
      for (const key of ['user', 'currentUser', 'profile', 'userData', 'auth']) {
        const raw = localStorage.getItem(key);
        if (raw && (raw.startsWith('{') || raw.startsWith('['))) {
          const parsed = JSON.parse(raw);
          const u = parsed.user || parsed;
          if (u.name || u.username) {
            myProfileInfo.myName = u.name || u.username;
          }
          if (u.id || u.userid) {
            myProfileInfo.myId = Number(u.id || u.userid);
          }
          if (myProfileInfo.myName !== 'אתה') break;
        }
      }
    } catch (e) {}

    // Fallback: Check top navbar / user menu in Stips page
    if (myProfileInfo.myName === 'אתה') {
      const links = document.querySelectorAll('header a[href*="/profile/"], nav a[href*="/profile/"], .user-avatar, .user_box');
      for (const a of links) {
        if (a.closest('.mat-dialog-container, [role="dialog"], #messages-wrapper, [class*="chat-window"]')) continue;
        const text = a.textContent?.trim();
        if (text && text.length >= 2 && text.length <= 30 && !text.includes('הודעות')) {
          myProfileInfo.myName = text;
          break;
        }
      }
    }

    return myProfileInfo;
  }

  function cleanRawUserName(raw) {
    if (!raw) return '';
    return raw
      .replace(/(?:בת|בן)\s+\d+/g, '')
      .replace(/מסומן/g, '')
      .replace(/\d+\s+(?:שניות|דקות|שעות|ימים|שבועות|חודשים|שנים)/g, '')
      .replace(/לפני\s+\S+/g, '')
      .replace(/^[\s,.:;•\-#"'״׳]+|[\s,.:;•\-#"'״׳]+$/g, '')
      .trim();
  }

  function isValidUsername(txt) {
    if (!txt) return false;
    if (txt.length < 2 || txt.length > 30) return false;
    if (txt.includes('#') || txt.includes('\n')) return false;
    if (txt.split(/\s+/).length > 4) return false;
    const excludeWords = ['הורד', 'הודעה', 'ההודעה', 'תגובה', 'פרטים', 'עריכה', 'מחיקה', 'שניות', 'דקות', 'שעות', 'לפני'];
    if (excludeWords.some((w) => txt === w)) return false;
    return true;
  }

  function extractCardUserName(item, link) {
    if (link) {
      const linkText = cleanRawUserName(link.textContent);
      if (isValidUsername(linkText)) return linkText;

      const userHeader = link.closest('[class*="user"], [class*="author"], [class*="profile"], [class*="header"], [class*="item"]');
      if (userHeader) {
        const nickEls = userHeader.querySelectorAll('[class*="user-name"], [class*="username"], [class*="nick"], [class*="author"], strong, b');
        for (const el of nickEls) {
          if (el.children.length > 0) continue;
          const t = cleanRawUserName(el.textContent);
          if (isValidUsername(t)) return t;
        }

        const spans = userHeader.querySelectorAll('span, a');
        for (const s of spans) {
          if (s.children.length > 0) continue;
          const t = cleanRawUserName(s.textContent);
          if (isValidUsername(t)) return t;
        }
      }
    }

    if (item) {
      const directUserEls = item.querySelectorAll('[class*="username"], [class*="user-name"], [class*="author"], [class*="nick"]');
      for (const el of directUserEls) {
        if (el.children.length > 0) continue;
        const t = cleanRawUserName(el.textContent);
        if (isValidUsername(t)) return t;
      }
    }

    return 'משתמש';
  }

  // 2. Chat Header Download Button: Injected DIRECTLY inside .messages-toolbar mat-toolbar
  // Eliminates any white bar and sits cleanly next to the 3-dots actions area.
  function updateChatHeaderButton() {
    const toolbar = document.querySelector('.messages-toolbar mat-toolbar, app-messages mat-toolbar');
    const existingBtn = document.getElementById('stips-download-header-btn');

    if (!toolbar || toolbar.offsetParent === null) {
      if (existingBtn) existingBtn.remove();
      return;
    }

    // Partner info directly from the header
    const nameEl = toolbar.querySelector('.user-nickname, [class*="nickname"]');
    const partnerName = nameEl?.textContent.trim() || 'משתמש סטיפס';

    const locMatch = window.location.href.match(/\/messages\/(\d+)/);
    const linkProfile = toolbar.querySelector('a[href*="/profile/"]');
    const profMatch = linkProfile?.getAttribute('href')?.match(/\/profile\/(\d+)/);
    const partnerId = locMatch ? Number(locMatch[1]) : (profMatch ? Number(profMatch[1]) : null);

    // If existing button is outside this toolbar, remove it
    if (existingBtn && !toolbar.contains(existingBtn)) {
      existingBtn.remove();
    }

    const currentBtn = document.getElementById('stips-download-header-btn');
    if (!currentBtn || !toolbar.contains(currentBtn)) {
      const btn = document.createElement('button');
      btn.id = 'stips-download-header-btn';
      btn.className = 'stips-download-chat-btn';
      btn.type = 'button';
      btn.title = `הורד שיחה עם ${partnerName}`;
      btn.innerHTML = `
        <span class="stips-dl-btn-icon">${DOWNLOAD_ICON_SVG}</span>
        <span class="stips-dl-btn-text">הורד שיחה</span>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const freshLoc = window.location.href.match(/\/messages\/(\d+)/);
        const targetId = freshLoc ? Number(freshLoc[1]) : partnerId;
        if (targetId) {
          startDownloadFlow(targetId, partnerName);
        } else {
          alert('לא ניתן לזהות את מזהה השיחה.');
        }
      });

      const actionsArea = toolbar.querySelector('.actions-area, button.item-actions, button');
      if (actionsArea && actionsArea.parentElement === toolbar) {
        toolbar.insertBefore(btn, actionsArea);
      } else {
        toolbar.appendChild(btn);
      }
    }
  }

  // 3. Conversation List Download Buttons: Injected inside a.list-message in the messages list
  function injectInboxListButtons() {
    const rows = document.querySelectorAll('a.list-message, .messages-list a[href*="/messages/"]');

    rows.forEach((row) => {
      if (row.querySelector('.stips-download-row-btn')) return;

      const href = row.getAttribute('href') || '';
      const m = href.match(/\/messages\/(\d+)/);
      if (!m) return;

      const pid = Number(m[1]);
      const nameEl = row.querySelector('.nickname, [class*="nickname"]');
      const partnerName = nameEl?.textContent.trim() || 'משתמש סטיפס';

      try {
        if (window.getComputedStyle(row).position === 'static') {
          row.style.position = 'relative';
        }
      } catch (e) {}

      const btn = document.createElement('button');
      btn.className = 'stips-download-row-btn';
      btn.type = 'button';
      btn.title = `הורד שיחה עם ${partnerName} (${pid})`;
      btn.innerHTML = `
        <span class="stips-dl-row-icon">${DOWNLOAD_ICON_SVG}</span>
        <span class="stips-dl-row-text">הורד</span>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDownloadFlow(pid, partnerName);
      });

      row.appendChild(btn);
    });
  }

  // 4. Pen-Friends Feed Cards: Injected inside .item-card on /pen-friends
  function injectPenFriendsButtons() {
    if (!window.location.pathname.includes('pen-friends')) return;

    const cards = document.querySelectorAll('.item-card, app-pen-friend-card, [class*="pen-friend-card"]');
    cards.forEach((card) => {
      if (card.querySelector('.stips-download-row-btn')) return;

      const link = card.querySelector('a[href*="/messages/"], a[href*="/profile/"]');
      if (!link) return;

      const href = link.getAttribute('href') || '';
      const m = href.match(/\/(?:messages|profile)\/(\d+)/);
      if (!m) return;

      const pid = Number(m[1]);
      if (myProfileInfo.myId && pid === myProfileInfo.myId) return;

      const name = extractCardUserName(card, link);

      try {
        if (window.getComputedStyle(card).position === 'static') {
          card.style.position = 'relative';
        }
      } catch (e) {}

      const btn = document.createElement('button');
      btn.className = 'stips-download-row-btn';
      btn.type = 'button';
      btn.title = `הורד שיחה עם ${name} (${pid})`;
      btn.innerHTML = `
        <span class="stips-dl-row-icon">${DOWNLOAD_ICON_SVG}</span>
        <span class="stips-dl-row-text">הורד</span>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDownloadFlow(pid, name);
      });

      card.appendChild(btn);
    });
  }

  // 5. Update UI: Orchestrates header, inbox list, and pen friends
  function updateUI() {
    // Prune any rogue button in site navbar or input area
    document.querySelectorAll(
      'header #stips-download-header-btn, .site-header #stips-download-header-btn, app-header #stips-download-header-btn, nav #stips-download-header-btn, [class*="navbar"] #stips-download-header-btn, input ~ #stips-download-header-btn, textarea ~ #stips-download-header-btn'
    ).forEach((b) => b.remove());

    updateChatHeaderButton();
    injectInboxListButtons();
    injectPenFriendsButtons();
  }

  // 6. Shadow DOM Modal Infrastructure (Zero-Flicker Architecture & Pointer Protection)
  function initShadowModal() {
    if (shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'stips-download-shadow-host';
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '9999999';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        --primary: #09c286;
        --primary-dark: #07a370;
        --accent-red: #c9372f;
        --bg-card: #ffffff;
        --text-main: #212529;
        --text-muted: #6c757d;
        --border: #dee2e6;
        --shadow: 0 10px 25px rgba(0,0,0,0.25);
        --radius: 12px;
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        direction: rtl;
        pointer-events: none;
      }

      .modal-backdrop {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999999;
        pointer-events: auto;
      }

      .modal-box {
        background: var(--bg-card);
        width: 90%;
        max-width: 480px;
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        overflow: hidden;
        border: 1px solid var(--border);
        animation: popIn 0.2s ease-out;
      }

      @keyframes popIn {
        from { transform: scale(0.92); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }

      .modal-header {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f8f9fa;
      }

      .modal-title {
        font-size: 16px;
        font-weight: 700;
        color: var(--text-main);
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .close-btn {
        background: transparent;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--text-muted);
        line-height: 1;
        padding: 4px;
      }

      .modal-body {
        padding: 20px;
      }

      .status-text {
        font-size: 14px;
        color: var(--text-main);
        margin-bottom: 14px;
        line-height: 1.5;
        min-height: 22px;
      }

      .progress-bar-container {
        height: 12px;
        background: #e9ecef;
        border-radius: 6px;
        overflow: hidden;
        margin-bottom: 16px;
        position: relative;
        box-shadow: inset 0 1px 2px rgba(0,0,0,0.08);
      }

      .progress-bar {
        height: 100%;
        width: 100%;
        background: linear-gradient(90deg, #09c286 0%, #34d399 30%, #a7f3d0 50%, #34d399 70%, #09c286 100%);
        background-size: 200% 100%;
        animation: progressFlow 1.6s infinite linear;
        border-radius: 6px;
      }

      @keyframes progressFlow {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        background: #f8f9fa;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 16px;
        font-size: 13px;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
      }

      .stat-label {
        font-size: 11px;
        color: var(--text-muted);
      }

      .stat-val {
        font-weight: 700;
        color: var(--text-main);
        margin-top: 2px;
      }

      .modal-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
      }

      button.btn {
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid var(--border);
        background: #ffffff;
        color: var(--text-main);
        transition: all 0.15s ease;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      button.btn:hover {
        background: #f1f3f5;
      }

      button.btn-primary {
        background: var(--primary);
        color: #ffffff;
        border-color: var(--primary);
      }

      button.btn-primary:hover {
        background: var(--primary-dark);
      }

      button.btn-danger {
        color: var(--accent-red);
      }

      .success-banner {
        background: #e8f8f2;
        color: #079c6c;
        padding: 12px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
      }

      .warning-banner {
        background: #fff3e0;
        color: #e65100;
        padding: 12px;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 16px;
      }
    `;

    shadowRoot.appendChild(style);

    modalContainer = document.createElement('div');
    modalContainer.className = 'modal-backdrop';
    modalContainer.style.display = 'none';
    shadowRoot.appendChild(modalContainer);
  }

  function hideModal() {
    if (modalContainer) {
      modalContainer.style.display = 'none';
    }
  }

  // Mounts the downloading modal shell ONCE to eliminate flickering
  function mountDownloadingModal(partnerId, partnerName) {
    initShadowModal();

    modalContainer.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title">
            <span>מוריד שיחה עם ${partnerName} (${partnerId})</span>
          </div>
          <button class="close-btn" id="modal-close-x">✕</button>
        </div>
        <div class="modal-body">
          <div class="status-text" id="modal-status-text">מתחבר ל-API...</div>
          <div class="progress-bar-container">
            <div class="progress-bar" id="modal-progress-bar"></div>
          </div>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">הודעות שהורדו</span>
              <span class="stat-val" id="modal-stat-count">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">סבבי API</span>
              <span class="stat-val" id="modal-stat-batches">0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">הודעה ישנה ביותר</span>
              <span class="stat-val" id="modal-stat-date">מתחבר...</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">מזהה שיחה</span>
              <span class="stat-val">${partnerId}</span>
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn" id="btn-modal-pause">⏸ השהה</button>
            <button class="btn btn-danger" id="btn-modal-cancel">ביטול</button>
            <button class="btn" id="btn-modal-export-partial">ייצא ארכיון ביניים</button>
          </div>
        </div>
      </div>
    `;

    modalDOMElements = {
      status: modalContainer.querySelector('#modal-status-text'),
      count: modalContainer.querySelector('#modal-stat-count'),
      batches: modalContainer.querySelector('#modal-stat-batches'),
      date: modalContainer.querySelector('#modal-stat-date'),
      progressBar: modalContainer.querySelector('#modal-progress-bar'),
      pauseBtn: modalContainer.querySelector('#btn-modal-pause')
    };

    modalContainer.querySelector('#modal-close-x')?.addEventListener('click', hideModal);

    modalDOMElements.pauseBtn?.addEventListener('click', () => {
      isPaused = !isPaused;
      modalDOMElements.pauseBtn.textContent = isPaused ? '▶ המשך הורדה' : '⏸ השהה';
      modalDOMElements.status.textContent = isPaused ? 'ההורדה הושהתה. תוכל להמשיך בכל שלב.' : 'ממשיך הורדה...';
    });

    modalContainer.querySelector('#btn-modal-cancel')?.addEventListener('click', () => {
      if (activeAbortController) {
        activeAbortController.abort();
      }
      hideModal();
    });

    modalContainer.querySelector('#btn-modal-export-partial')?.addEventListener('click', async () => {
      await handleExportAction('html');
    });

    modalContainer.style.display = 'flex';
  }

  // Smooth live element updates without destroying DOM or flickering
  function updateDownloadProgress({ status, count, batches, oldestDate }) {
    if (!modalDOMElements) return;

    if (status && modalDOMElements.status) {
      modalDOMElements.status.textContent = status;
    }
    if (count !== undefined && modalDOMElements.count) {
      modalDOMElements.count.textContent = count.toLocaleString('he-IL');
    }
    if (batches !== undefined && modalDOMElements.batches) {
      modalDOMElements.batches.textContent = batches;
    }
    if (oldestDate && modalDOMElements.date) {
      modalDOMElements.date.textContent = oldestDate;
    }
  }

  // Displays completion state with export buttons
  function showCompletedModal(partnerId, partnerName, count, batches, report) {
    if (!modalContainer) return;

    const rep = report || {};
    const warningHtml =
      rep.undatedCount > 0
        ? `<div class="warning-banner">שים לב: ${rep.undatedCount} הודעות ירדו ללא חותמת זמן תקינה.</div>`
        : '';

    modalContainer.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <div class="modal-title">
            <span>✓ שיחת ${partnerName} (${partnerId}) נשמרה</span>
          </div>
          <button class="close-btn" id="modal-close-x">✕</button>
        </div>
        <div class="modal-body">
          <div class="success-banner">
            <span>השיחה הורדה במלואה ונשמרה בארכיון המקומי.</span>
          </div>
          ${warningHtml}
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">סך הודעות</span>
              <span class="stat-val">${count.toLocaleString('he-IL')}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">סבבי API</span>
              <span class="stat-val">${batches}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">הודעה ראשונה</span>
              <span class="stat-val">${rep.oldestDate || 'לא זמין'}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">הודעה אחרונה</span>
              <span class="stat-val">${rep.newestDate || 'לא זמין'}</span>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-primary" id="btn-modal-open-archive">🚀 פתח ארכיון בדפדפן</button>
            <button class="btn" id="btn-modal-download-html">הורד HTML</button>
            <button class="btn" id="btn-modal-download-json">JSON</button>
            <button class="btn" id="btn-modal-download-txt">TXT</button>
          </div>
        </div>
      </div>
    `;

    modalContainer.querySelector('#modal-close-x')?.addEventListener('click', hideModal);
    modalContainer.querySelector('#btn-modal-open-archive')?.addEventListener('click', handleOpenArchiveInTab);
    modalContainer.querySelector('#btn-modal-download-html')?.addEventListener('click', () => handleExportAction('html'));
    modalContainer.querySelector('#btn-modal-download-json')?.addEventListener('click', () => handleExportAction('json'));
    modalContainer.querySelector('#btn-modal-download-txt')?.addEventListener('click', () => handleExportAction('txt'));

    modalContainer.style.display = 'flex';
  }

  // 7. Core Download Execution
  async function startDownloadFlow(targetId, targetName) {
    currentPartnerId = Number(targetId);
    currentPartnerName = targetName || 'משתמש סטיפס';
    isPaused = false;
    activeAbortController = new AbortController();

    // Refresh profile detection for "אתה"
    detectMyProfile();

    console.log(`🚀 Starting download for Partner ID: ${currentPartnerId} (${currentPartnerName})`);

    mountDownloadingModal(currentPartnerId, currentPartnerName);

    const existingJob = await getJob(currentPartnerId).catch(() => null);
    const existingMessages = await getMessages(currentPartnerId).catch(() => []);

    let messagesDownloaded = existingMessages.length;
    let cursor = existingJob?.cursor || null;
    let batchesCount = existingJob?.batchesCount || 0;
    let isFirstLoad = !cursor && messagesDownloaded === 0;

    updateDownloadProgress({
      status: `מתחבר ל-API ומוריד את שיחת ${currentPartnerName} (${currentPartnerId})...`,
      count: messagesDownloaded,
      batches: batchesCount,
      oldestDate: existingMessages[0]?.gregorianDate || 'טרם הורד'
    });

    const seenIds = new Set(existingMessages.map((m) => m.id));

    try {
      while (true) {
        if (isPaused) {
          await new Promise((resolve) => {
            const check = setInterval(() => {
              if (!isPaused || activeAbortController.signal.aborted) {
                clearInterval(check);
                resolve();
              }
            }, 250);
          });
        }

        if (activeAbortController.signal.aborted) {
          updateDownloadProgress({
            status: 'ההורדה בוטלה על ידי המשתמש.',
            count: messagesDownloaded,
            batches: batchesCount
          });
          return;
        }

        updateDownloadProgress({
          status: 'מוריד היסטוריית הודעות מה-API...',
          count: messagesDownloaded,
          batches: batchesCount,
          oldestDate: existingMessages[0]?.gregorianDate || 'מעבד...'
        });

        let rawMessages;
        try {
          rawMessages = await fetchMessagesBatch({
            partnerId: currentPartnerId,
            cursor,
            isFirstLoad,
            callerSignal: activeAbortController.signal,
            onRetry: (retryInfo) => {
              updateDownloadProgress({
                status: retryInfo.message,
                count: messagesDownloaded,
                batches: batchesCount
              });
            }
          });
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') return;
          throw fetchErr;
        }

        if (!rawMessages || rawMessages.length === 0) {
          console.log('No more messages returned by API. Download complete.');
          break;
        }

        const normalizedBatch = [];
        let minIdInBatch = null;

        for (const raw of rawMessages) {
          const norm = normalizeApiMessage(raw, currentPartnerId, currentPartnerName, myProfileInfo.myName);
          if (norm) {
            if (!seenIds.has(norm.id)) {
              seenIds.add(norm.id);
              normalizedBatch.push(norm);
            }
            if (minIdInBatch === null || norm.id < minIdInBatch) {
              minIdInBatch = norm.id;
            }
          }
        }

        batchesCount++;
        isFirstLoad = false;

        if (normalizedBatch.length === 0 && cursor !== null) {
          console.log('No new unique messages in batch. Download reached beginning of chat.');
          break;
        }

        if (minIdInBatch !== null) {
          cursor = minIdInBatch;
        }

        await saveBatch({
          partnerId: currentPartnerId,
          partnerName: currentPartnerName,
          messages: normalizedBatch,
          cursor,
          batchesCount,
          status: 'downloading'
        });

        messagesDownloaded = seenIds.size;

        updateDownloadProgress({
          status: 'מאמת ושומר אצוות הודעות...',
          count: messagesDownloaded,
          batches: batchesCount,
          oldestDate: normalizedBatch[0]?.gregorianDate || 'בתהליך...'
        });

        await new Promise((r) => setTimeout(r, 180));
      }

      const report = await getValidationReport(currentPartnerId);

      await saveJob({
        partnerId: currentPartnerId,
        partnerName: currentPartnerName,
        cursor,
        messagesDownloaded: report.total,
        batchesCount,
        status: 'completed'
      });

      showCompletedModal(currentPartnerId, currentPartnerName, report.total, batchesCount, report);
    } catch (err) {
      console.error('Download error:', err);
      updateDownloadProgress({
        status: `שגיאה בהורדה: ${err.message}`,
        count: messagesDownloaded,
        batches: batchesCount
      });
    }
  }

  // 8. Exports
  async function handleExportAction(format) {
    const messages = await getMessages(currentPartnerId);
    if (!messages || messages.length === 0) {
      alert('אין עדיין הודעות שמורות ליצוא.');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = sanitizeFilename(currentPartnerName);

    if (format === 'html') {
      const html = buildArchiveHtml({
        metadata: {
          partnerId: currentPartnerId,
          partnerName: currentPartnerName,
          myProfileName: myProfileInfo.myName
        },
        messages
      });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      triggerFileDownload(blob, `stips_${safeName}_${dateStr}.html`);
    } else if (format === 'json') {
      const payload = {
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        partnerId: currentPartnerId,
        partnerName: currentPartnerName,
        myProfileName: myProfileInfo.myName,
        messagesCount: messages.length,
        messages
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      triggerFileDownload(blob, `stips_${safeName}_${dateStr}.json`);
    } else if (format === 'txt') {
      const txt = generateTxtContent(currentPartnerName, currentPartnerId, messages);
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      triggerFileDownload(blob, `stips_${safeName}_${dateStr}.txt`);
    }
  }

  async function handleOpenArchiveInTab() {
    const messages = await getMessages(currentPartnerId);
    const html = buildArchiveHtml({
      metadata: {
        partnerId: currentPartnerId,
        partnerName: currentPartnerName,
        myProfileName: myProfileInfo.myName
      },
      messages
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  }

  // 9. SPA Navigation Watcher and Mutation Observer
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  history.pushState = function (...args) {
    origPushState.apply(this, args);
    setTimeout(updateUI, 100);
  };

  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    setTimeout(updateUI, 100);
  };

  window.addEventListener('popstate', () => {
    setTimeout(updateUI, 100);
  });

  let mutationTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(updateUI, 200);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(updateUI, 600);

  // Initial Run
  detectMyProfile();
  updateUI();
})();
