/**
 * Stips Download - Content Script
 * Seamless turquoise chat header injection, zero interference with main site header,
 * chat inputs or sidebars, shadow-DOM progress modal, and resilient background download coordinator.
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
  let detectedPartnerId = null;
  let detectedPartnerName = null;
  let lastClickedPartner = null;
  const partnerIdMap = new Map(); // partnerName -> partnerId

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

  // 1. Inject Main-World API Hook to intercept Stips messages API in real-time
  function injectMainWorldHook() {
    try {
      const script = document.createElement('script');
      script.id = 'stips-download-main-hook';
      script.textContent = `
        (() => {
          if (window.__STIPS_HOOK_INSTALLED__) return;
          window.__STIPS_HOOK_INSTALLED__ = true;

          function handleUrl(url) {
            try {
              if (typeof url === 'string' && url.includes('messages.from_user')) {
                const match = url.match(/api_params=([^&]+)/);
                if (match) {
                  const decoded = decodeURIComponent(match[1]);
                  const params = JSON.parse(decoded);
                  if (params && params.userid) {
                    window.dispatchEvent(new CustomEvent('stips_partner_detected', {
                      detail: { partnerId: Number(params.userid) }
                    }));
                  }
                }
              }
            } catch (e) {}
          }

          // Hook window.fetch
          const origFetch = window.fetch;
          window.fetch = function(...args) {
            if (args[0]) handleUrl(args[0]);
            return origFetch.apply(this, args);
          };

          // Hook XMLHttpRequest
          const origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            handleUrl(url);
            return origOpen.apply(this, [method, url, ...rest]);
          };
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {}
  }

  injectMainWorldHook();

  // Listen to partner detected from main world
  window.addEventListener('stips_partner_detected', (e) => {
    if (e.detail?.partnerId) {
      detectedPartnerId = Number(e.detail.partnerId);
      if (detectedPartnerName) {
        partnerIdMap.set(detectedPartnerName, detectedPartnerId);
      }
      updateUI();
    }
  });

  // Track clicks on user cards / links across the page
  document.addEventListener('click', (e) => {
    try {
      const target = e.target;
      if (!target) return;
      const link = target.closest('a[href*="/profile/"], a[href*="/messages/"]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/(?:profile|messages)\/(\d+)/);
        if (m) {
          const pid = Number(m[1]);
          const name = cleanRawUserName(link.textContent) || extractCardUserName(link.closest('[class*="card"], [class*="item"], mat-list-item') || link.parentElement, link);
          lastClickedPartner = { id: pid, name, time: Date.now() };
          if (name && isValidUsername(name)) {
            partnerIdMap.set(name, pid);
          }
        }
      }
    } catch (err) {}
  }, { passive: true, capture: true });

  // 2. Detect Logged-In User Profile ("אתה")
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

  // 3. Locate the Active Chat Dialog Container (Width 250px - 720px, Height >= 180px)
  // STRICT RULE: Never match the full-width main site header, navbar, or sidebar!
  function findActiveChatDialog() {
    // 1. Angular CDK overlay containers / Material dialogs / Stips chat popups
    const containers = document.querySelectorAll(
      '.cdk-overlay-pane, [role="dialog"], .mat-dialog-container, app-conversation, app-chat, [class*="chat-dialog"], [class*="chat-window"], [class*="chat-box"], [class*="conversation"]'
    );

    for (const el of containers) {
      if (el.offsetParent === null) continue; // hidden
      // Must be an actual chat dialog size, not full page width!
      if (el.clientWidth >= 250 && el.clientWidth <= 720 && el.clientHeight >= 180) {
        // Exclude site navbars or sidebars
        if (el.closest('header, .site-header, app-header, mat-sidenav, mat-drawer, nav')) continue;
        return el;
      }
    }

    // 2. Fallback: Find 3-dots icon (⋮) in an open chat and get its dialog container
    const icons = document.querySelectorAll('mat-icon, button, [role="button"], span');
    for (const ic of icons) {
      const txt = (ic.textContent || '').trim();
      if (txt === '⋮' || txt === 'more_vert' || txt === '•••') {
        if (ic.closest('header, .site-header, app-header, mat-sidenav, mat-drawer, nav')) continue;
        let cur = ic.parentElement;
        while (cur && cur !== document.body) {
          if (cur.clientWidth >= 250 && cur.clientWidth <= 720 && cur.clientHeight >= 180 && cur.offsetParent !== null) {
            return cur;
          }
          cur = cur.parentElement;
        }
      }
    }

    return null;
  }

  // 4. Locate the Turquoise Header strictly INSIDE the Active Chat Dialog
  function findTurquoiseChatHeader() {
    const dialog = findActiveChatDialog();
    if (!dialog) return null;

    // Search strictly INSIDE the chat dialog for its top bar
    const candidates = dialog.querySelectorAll('mat-toolbar, header, [class*="header"], [class*="top"], div');
    for (const el of candidates) {
      if (el.clientHeight < 36 || el.clientHeight > 92) continue;
      if (el.clientWidth < 180 || el.clientWidth > 720) continue;
      if (el.offsetParent === null) continue;

      // STRICT EXCLUSION: Never touch the bottom input area or footer!
      if (el.querySelector('input, textarea, [class*="send"], [class*="emoji"]')) continue;

      // Check turquoise background color (rgb(9, 194, 134))
      const bg = window.getComputedStyle(el).backgroundColor;
      const rgb = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (rgb) {
        const r = parseInt(rgb[1], 10);
        const g = parseInt(rgb[2], 10);
        const b = parseInt(rgb[3], 10);
        if (g >= 150 && b >= 80 && r <= 85) {
          return el;
        }
      }

      // Check if it contains the 3-dots icon or partner avatar/name
      const txt = el.textContent || '';
      if (txt.includes('⋮') || txt.includes('more_vert') || el.querySelector('mat-icon, [class*="dots"]')) {
        return el;
      }
    }

    // Fallback: check first child of dialog if sized properly
    const first = dialog.firstElementChild;
    if (first && first.clientHeight >= 36 && first.clientHeight <= 92 && !first.querySelector('input, textarea')) {
      return first;
    }

    return null;
  }

  // Find top-level child of header containing the 3-dots button
  function findTopChildForThreeDots(header) {
    if (!header) return null;
    const buttons = header.querySelectorAll('button, [role="button"], mat-icon, span');
    for (const b of buttons) {
      const txt = (b.textContent || '').trim();
      if (txt === '⋮' || txt === 'more_vert' || txt === '•••' || b.getAttribute('aria-label')?.includes('עוד')) {
        let cur = b;
        while (cur.parentElement && cur.parentElement !== header) {
          cur = cur.parentElement;
        }
        return cur;
      }
    }
    return null;
  }

  // 5. Resolve Partner Info (Name & ID) from Chat Header and Environment
  function resolveChatPartner(header) {
    if (!header) return null;

    let partnerName = '';
    let partnerId = null;

    // A. Check URL: /messages/:id or /profile/:id
    const locMatch = window.location.href.match(/\/(?:messages|profile)\/(\d+)/);
    if (locMatch) partnerId = Number(locMatch[1]);

    // B. Extract name from leaf text nodes inside turquoise header
    const textEls = header.querySelectorAll('h1, h2, h3, h4, span, div, a');
    for (const t of textEls) {
      if (t.children.length > 0) continue;
      const txt = (t.textContent || '').trim();
      if (!txt || txt === '⋮' || txt === 'more_vert' || txt === '•••' || txt.includes('הורד')) continue;
      if (txt.length >= 2 && txt.length <= 40) {
        partnerName = txt;
        break;
      }
    }

    // C. Check if header has link
    const headerLink = header.querySelector('a[href*="/profile/"], a[href*="/messages/"]');
    if (headerLink) {
      const m = (headerLink.getAttribute('href') || '').match(/\/(?:profile|messages)\/(\d+)/);
      if (m) partnerId = Number(m[1]);
    }

    // D. Check image src in header
    if (!partnerId) {
      const img = header.querySelector('img');
      if (img && img.src) {
        const im = img.src.match(/(?:user_?|profile_?|uid_?)(\d+)/i);
        if (im) partnerId = Number(im[1]);
      }
    }

    // E. Check detectedPartnerId from network hook
    if (!partnerId && detectedPartnerId) {
      partnerId = detectedPartnerId;
    }

    // F. Check partnerIdMap by partnerName
    if (!partnerId && partnerName && partnerIdMap.has(partnerName)) {
      partnerId = partnerIdMap.get(partnerName);
    }

    // G. Check lastClickedPartner if clicked recently (< 60s)
    if (!partnerId && lastClickedPartner && (Date.now() - lastClickedPartner.time < 60000)) {
      if (!partnerName || partnerName === lastClickedPartner.name || !lastClickedPartner.name) {
        partnerId = lastClickedPartner.id;
        if (!partnerName && lastClickedPartner.name) partnerName = lastClickedPartner.name;
      }
    }

    // H. Scan page for card with the same partnerName
    if (!partnerId && partnerName) {
      const allLinks = document.querySelectorAll('a[href*="/profile/"], a[href*="/messages/"]');
      for (const a of allLinks) {
        if (a.closest('mat-sidenav, mat-drawer, header')) continue;
        if (cleanRawUserName(a.textContent) === partnerName) {
          const m = (a.getAttribute('href') || '').match(/\/(?:profile|messages)\/(\d+)/);
          if (m) {
            partnerId = Number(m[1]);
            partnerIdMap.set(partnerName, partnerId);
            break;
          }
        }
      }
    }

    return {
      partnerId,
      partnerName: partnerName || (partnerId ? `משתמש (${partnerId})` : 'שיחה')
    };
  }

  // Fallback to resolve Partner ID by querying inbox or search API if needed
  async function resolvePartnerIdByName(name) {
    if (!name) return null;
    try {
      const resp = await fetch('/api?name=messages.inbox', { credentials: 'include' });
      if (resp.ok) {
        const json = await resp.json();
        const items = json?.data?.conversations || json?.data?.messages || json?.data || [];
        if (Array.isArray(items)) {
          for (const item of items) {
            const partner = item.user || item.partner || item;
            const pName = partner.name || partner.username || partner.nick;
            const pId = partner.id || partner.userid || item.partner_id || item.userid;
            if (pName && pId && cleanRawUserName(pName) === cleanRawUserName(name)) {
              return Number(pId);
            }
          }
        }
      }
    } catch (e) {}

    try {
      const searchResp = await fetch('/api?name=users.search&api_params=' + encodeURIComponent(JSON.stringify({ query: name })), { credentials: 'include' });
      if (searchResp.ok) {
        const sJson = await searchResp.json();
        const users = sJson?.data?.users || sJson?.data || [];
        if (Array.isArray(users) && users.length > 0) {
          for (const u of users) {
            const uName = u.name || u.username;
            if (cleanRawUserName(uName) === cleanRawUserName(name)) {
              return Number(u.id || u.userid);
            }
          }
          if (users[0]?.id) return Number(users[0].id);
        }
      }
    } catch (e) {}

    return null;
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

  // 6. Inject candidate link buttons (ONLY on feed & conversation list, NEVER inside sidebar or chat!)
  function injectCandidateLinkButtons() {
    const links = document.querySelectorAll('a[href*="/messages/"], a[href*="/profile/"]');

    links.forEach((link) => {
      // RULE 1: STRICTLY EXCLUDE sidebar, navigation drawer, navbar, and site header!
      if (link.closest('mat-sidenav, mat-drawer, .mat-sidenav, .mat-drawer, [class*="sidenav"], [class*="drawer"], [class*="sidebar"], [class*="nav-menu"], nav, aside, header, .site-header, app-navigation, app-sidebar, app-menu')) {
        return;
      }

      // RULE 2: NEVER inject inside any chat dialog, chat window, or input area!
      if (link.closest('.mat-dialog-container, [role="dialog"], [class*="chat"], .chat-box, mat-toolbar')) {
        return;
      }

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/(?:messages|profile)\/(\d+)/);
      if (!match) return;

      const pid = Number(match[1]);

      // RULE 3: NEVER inject download button for logged-in user's own profile!
      if (myProfileInfo.myId && pid === myProfileInfo.myId) return;

      // RULE 4: Find the row container (mat-list-item or conversation row/card)
      const rowContainer = link.closest('mat-list-item, [role="listitem"], .mat-list-item, [class*="conversation"], [class*="chat-item"], [class*="message-item"], [class*="dialog-row"], [class*="card"], li');
      if (!rowContainer) return;

      // Ensure rowContainer is not inside the sidebar
      if (rowContainer.closest('mat-sidenav, mat-drawer, nav, aside, [class*="sidebar"]')) return;

      // Ensure at most ONE button per row container
      if (rowContainer.getAttribute('data-stips-download-injected') === '1') return;
      if (rowContainer.querySelector('.stips-download-row-btn')) return;

      rowContainer.setAttribute('data-stips-download-injected', '1');

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

  // 7. Update UI: Insert single button strictly into the Chat's Turquoise Header
  function updateUI() {
    // 1. Immediately clean up ANY button that appeared in the site main navbar, header, or input area
    document.querySelectorAll(
      'header #stips-download-header-btn, .site-header #stips-download-header-btn, app-header #stips-download-header-btn, nav #stips-download-header-btn, [class*="navbar"] #stips-download-header-btn, [class*="site-header"] #stips-download-header-btn, input ~ #stips-download-header-btn, textarea ~ #stips-download-header-btn, [class*="bottom"] #stips-download-header-btn, [class*="input"] #stips-download-header-btn, .stips-download-mini-btn'
    ).forEach((b) => b.remove());

    const turquoiseHeader = findTurquoiseChatHeader();
    const existingBtn = document.getElementById('stips-download-header-btn');

    if (!turquoiseHeader) {
      // Chat is closed / user exited: immediately remove the download button!
      if (existingBtn) {
        existingBtn.remove();
      }
    } else {
      const info = resolveChatPartner(turquoiseHeader);
      detectedPartnerName = info.partnerName;
      if (info.partnerId) detectedPartnerId = info.partnerId;

      // If button already exists inside this turquoiseHeader, keep it!
      if (!existingBtn || !turquoiseHeader.contains(existingBtn)) {
        if (existingBtn) existingBtn.remove();

        const btn = document.createElement('button');
        btn.id = 'stips-download-header-btn';
        btn.className = 'stips-download-chat-btn';
        btn.type = 'button';
        btn.title = `הורד שיחה זו לארכיון מקומי`;
        btn.innerHTML = `
          <span class="stips-dl-btn-icon">${DOWNLOAD_ICON_SVG}</span>
          <span class="stips-dl-btn-text">הורד שיחה</span>
        `;

        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const freshInfo = resolveChatPartner(turquoiseHeader);
          let targetId = freshInfo.partnerId || detectedPartnerId;
          let targetName = freshInfo.partnerName || detectedPartnerName || 'משתמש סטיפס';

          if (!targetId) {
            targetId = await resolvePartnerIdByName(targetName);
          }

          if (targetId) {
            startDownloadFlow(targetId, targetName);
          } else {
            alert('לא ניתן לזהות את מזהה השיחה באופן אוטומטי. אנא נסה לרענן את העמוד או לפתוח את השיחה מחדש.');
          }
        });

        // Insert inside the turquoise header next to the 3-dots button
        const actionChild = findTopChildForThreeDots(turquoiseHeader);
        if (actionChild && actionChild.parentNode === turquoiseHeader) {
          turquoiseHeader.insertBefore(btn, actionChild);
        } else if (actionChild && actionChild.parentElement) {
          actionChild.parentElement.insertBefore(btn, actionChild);
        } else {
          turquoiseHeader.prepend(btn);
        }
      }
    }

    // Candidate buttons in feed rows
    injectCandidateLinkButtons();
  }

  // 8. Shadow DOM Modal Infrastructure (Zero-Flicker Architecture & Pointer Protection)
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

  // 9. Core Download Execution
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

  // 10. Exports
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

  // 11. SPA Navigation Watcher and Mutation Observer
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
