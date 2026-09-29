/**
 * Stips Download - Content Script
 * Seamless chat detection, discreet UI injection, shadow-DOM progress modal,
 * and resilient background download coordinator.
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

  // DOM elements cached inside Shadow Modal to prevent flicker
  let modalDOMElements = null;

  // Download Icon SVG
  const DOWNLOAD_ICON_SVG = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
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

  // 2. Locate the active open chat window on screen
  function findActiveChatWindow() {
    // Strategy A: Modal / Dialog container with chat contents currently visible
    const modals = document.querySelectorAll('.mat-dialog-container, [role="dialog"], [class*="chat-window"], [class*="chat_box"], .chat-box');
    for (const m of modals) {
      if (m.clientHeight > 180 && m.clientWidth > 180 && m.offsetParent !== null) {
        const style = window.getComputedStyle(m);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
          return m;
        }
      }
    }

    // Strategy B: Chat input box parent container
    const inputs = document.querySelectorAll('input, textarea');
    for (const inp of inputs) {
      const ph = inp.placeholder || '';
      const aria = inp.getAttribute('aria-label') || '';
      if (ph.includes('הודעה') || ph.includes('ההודעה שלך') || aria.includes('הודעה')) {
        let cur = inp.parentElement;
        while (cur && cur !== document.body) {
          if (cur.clientHeight > 200 && cur.clientWidth > 200 && cur.offsetParent !== null) {
            return cur;
          }
          cur = cur.parentElement;
        }
      }
    }

    return null;
  }

  // 3. Locate the green header bar inside the chat window
  function getGreenHeader(chatWindow) {
    if (!chatWindow) return null;

    // Search for toolbar or header element
    const headers = chatWindow.querySelectorAll('mat-toolbar, header, [class*="header"], [class*="top"]');
    for (const h of headers) {
      if (h.clientHeight >= 35 && h.clientHeight <= 95) {
        return h;
      }
    }

    // Check first visual top bar of chatWindow
    for (let i = 0; i < Math.min(chatWindow.children.length, 3); i++) {
      const child = chatWindow.children[i];
      if (child.clientHeight >= 35 && child.clientHeight <= 95) {
        return child;
      }
    }

    return null;
  }

  // 4. Resolve active chat info (Partner ID, Name, Green Header)
  // Strictly isolates the active chat partner to ensure no incorrect chat history is ever downloaded!
  function resolveActiveChatInfo() {
    const loc = window.location.href;
    const msgMatch = loc.match(/\/messages\/(\d+)/);
    const profileMatch = loc.match(/\/profile\/(\d+)/);

    let partnerId = null;
    let partnerName = '';
    const chatWindow = findActiveChatWindow();
    const greenHeader = getGreenHeader(chatWindow);

    // If chat dialog is open, the partner MUST be extracted from the greenHeader (NOT from chat body!)
    if (greenHeader) {
      const headerLink = greenHeader.querySelector('a[href*="/profile/"], a[href*="/messages/"]');
      if (headerLink) {
        const hm = (headerLink.getAttribute('href') || '').match(/\/(?:profile|messages)\/(\d+)/);
        if (hm) {
          partnerId = Number(hm[1]);
        }
      }

      // Extract partner name from greenHeader
      const textEls = greenHeader.querySelectorAll('h1, h2, h3, h4, span, a, div');
      for (const t of textEls) {
        const txt = t.textContent?.trim() || '';
        if (txt && txt !== '⋮' && txt !== 'more_vert' && txt !== '•••' && !txt.includes('הורד')) {
          if (txt.length >= 2 && txt.length <= 40 && t.children.length === 0) {
            partnerName = txt;
            break;
          }
        }
      }
    }

    // If no ID from header link, check if URL is on /messages/:id
    if (!partnerId && msgMatch) {
      partnerId = Number(msgMatch[1]);
    }

    // If on a profile page: /profile/:id
    if (!partnerId && profileMatch) {
      partnerId = Number(profileMatch[1]);
    }

    // If neither exists -> no active chat is open!
    if (!partnerId) {
      return null;
    }

    if (!partnerName) {
      const docTitle = document.title;
      if (docTitle && docTitle.includes('-')) {
        partnerName = docTitle.split('-')[0].trim();
      }
    }

    return {
      partnerId,
      partnerName: partnerName || `משתמש (${partnerId})`,
      chatWindow,
      greenHeader
    };
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

    const directUserEls = item.querySelectorAll('[class*="username"], [class*="user-name"], [class*="author"], [class*="nick"]');
    for (const el of directUserEls) {
      if (el.children.length > 0) continue;
      const t = cleanRawUserName(el.textContent);
      if (isValidUsername(t)) return t;
    }

    return 'משתמש';
  }

  // 5. Inject candidate link buttons (ONLY on feed & conversation list, on the SIDE of each row!)
  function injectCandidateLinkButtons() {
    const activeChat = resolveActiveChatInfo();

    const links = document.querySelectorAll('a[href*="/messages/"], a[href*="/profile/"]');

    links.forEach((link) => {
      // RULE 1: Never inject inside any chat dialog, chat window, header, toolbar, or messages body
      if (link.closest('.mat-dialog-container, [role="dialog"], [class*="chat-window"], [class*="chat_box"], .chat-box, header, mat-toolbar, [class*="header"]')) {
        return;
      }

      // RULE 2: If an active chat is open, do not inject into any part of that active chat
      if (activeChat) {
        if (activeChat.chatWindow && activeChat.chatWindow.contains(link)) return;
        if (activeChat.greenHeader && activeChat.greenHeader.contains(link)) return;
      }

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/(?:messages|profile)\/(\d+)/);
      if (!match) return;

      const pid = Number(match[1]);

      // RULE 3: Find the row container (mat-list-item or conversation row/card)
      const rowContainer = link.closest('mat-list-item, [role="listitem"], .mat-list-item, [class*="conversation"], [class*="chat-item"], [class*="message-item"], [class*="dialog-row"], [class*="card"], li') || link.parentElement;
      if (!rowContainer) return;

      // RULE 4: Ensure at most ONE button per row container!
      if (rowContainer.getAttribute('data-stips-download-injected') === '1') return;
      if (rowContainer.querySelector('.stips-download-row-btn')) return;

      rowContainer.setAttribute('data-stips-download-injected', '1');

      // Make rowContainer position: relative so the button aligns nicely on the left side
      try {
        const computedPos = window.getComputedStyle(rowContainer).position;
        if (computedPos === 'static') {
          rowContainer.style.position = 'relative';
        }
      } catch (e) {}

      // Extract REAL username cleanly
      const rowName = extractCardUserName(rowContainer, link);

      const btn = document.createElement('button');
      btn.className = 'stips-download-row-btn';
      btn.title = `הורד שיחה עם ${rowName} (${pid})`;
      btn.type = 'button';
      btn.innerHTML = `
        <span class="stips-dl-row-icon">${DOWNLOAD_ICON_SVG}</span>
        <span class="stips-dl-row-text">הורד</span>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDownloadFlow(pid, rowName);
      });

      rowContainer.appendChild(btn);
    });
  }

  // 6. Update UI: Insert single prominent button into green header or clean up when chat is closed
  function updateUI() {
    const activeChat = resolveActiveChatInfo();
    const existingBtn = document.getElementById('stips-download-header-btn');

    // Clean up any rogue mini buttons
    document.querySelectorAll('.stips-download-mini-btn, mat-toolbar .stips-download-mini-btn, header .stips-download-mini-btn, [role="dialog"] .stips-download-mini-btn, .mat-dialog-container .stips-download-mini-btn, [class*="chat-window"] .stips-download-mini-btn').forEach((b) => b.remove());

    if (!activeChat) {
      // Chat is closed / user exited: immediately remove the download button!
      if (existingBtn) {
        existingBtn.remove();
      }
      document.querySelectorAll('.stips-download-chat-btn, .stips-download-header-action').forEach((b) => b.remove());
    } else {
      // Chat IS active: ensure download button is in the green header bar
      if (activeChat.greenHeader) {
        const isCurrentPartner = existingBtn && existingBtn.getAttribute('data-partner-id') === String(activeChat.partnerId);

        if (!existingBtn || !activeChat.greenHeader.contains(existingBtn) || !isCurrentPartner) {
          if (existingBtn) existingBtn.remove();

          const btn = document.createElement('button');
          btn.id = 'stips-download-header-btn';
          btn.className = 'stips-download-chat-btn';
          btn.setAttribute('data-partner-id', String(activeChat.partnerId));
          btn.title = `הורד את השיחה עם ${activeChat.partnerName}`;
          btn.type = 'button';
          btn.innerHTML = `
            <span class="stips-dl-btn-icon">${DOWNLOAD_ICON_SVG}</span>
            <span class="stips-dl-btn-text">הורדת שיחה</span>
          `;

          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            startDownloadFlow(activeChat.partnerId, activeChat.partnerName);
          });

          // Insert inside green header: before the 3-dots button, or after partner title
          const threeDots = activeChat.greenHeader.querySelector('mat-icon, [role="button"], button:not(#stips-download-header-btn)');
          if (threeDots && threeDots.parentNode === activeChat.greenHeader) {
            activeChat.greenHeader.insertBefore(btn, threeDots);
          } else {
            activeChat.greenHeader.appendChild(btn);
          }
        }
      }
    }

    // Check conversation rows in inbox list
    injectCandidateLinkButtons();
  }

  // 7. Shadow DOM Modal Infrastructure (Defensive against Stips styles, Zero-Flicker Architecture)
  function initShadowModal() {
    if (shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'stips-download-shadow-host';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        --primary: #009688;
        --primary-dark: #00796b;
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

      /* Animated, smooth, non-flickering progress bar */
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
        background: linear-gradient(90deg, #009688 0%, #26a69a 30%, #80cbc4 50%, #26a69a 70%, #009688 100%);
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
        background: #e8f5e9;
        color: #2e7d32;
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

  // 8. Core Download Execution
  async function startDownloadFlow(targetId, targetName) {
    currentPartnerId = Number(targetId);
    currentPartnerName = targetName || 'משתמש סטיפס';
    isPaused = false;
    activeAbortController = new AbortController();

    // Refresh profile detection for "אתה"
    detectMyProfile();

    console.log(`🚀 Starting download for Partner ID: ${currentPartnerId} (${currentPartnerName})`);

    // Mount non-flickering modal shell
    mountDownloadingModal(currentPartnerId, currentPartnerName);

    // Check existing checkpoint for this SPECIFIC partner
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

  // 9. Exports
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

  // 10. SPA Navigation Watcher and Mutation Observer
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

  // Regular check interval to ensure button disappears immediately when exiting chat
  setInterval(updateUI, 600);

  // Initial Run
  detectMyProfile();
  updateUI();
})();
