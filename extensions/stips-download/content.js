/**
 * Stips Download - Content Script
 * Seamless chat detection, discreet UI injection, shadow-DOM progress modal,
 * and background download coordinator.
 */

(() => {
  // Prevent double injection
  if (window.__STIPS_DOWNLOAD_INITIALIZED__) return;
  window.__STIPS_DOWNLOAD_INITIALIZED__ = true;

  console.log('🚀 Stips Download Content Script Loaded');

  // State
  let currentPartnerId = null;
  let currentPartnerName = null;
  let activeAbortController = null;
  let isPaused = false;
  let shadowRoot = null;
  let modalContainer = null;

  // Icons Base64 / SVG
  const DOWNLOAD_ICON_SVG = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  // 1. Helper: extract chat partner ID from URL
  function getChatUserId(url = window.location.href) {
    const match = String(url).match(/\/messages\/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  // 2. Helper: extract partner name from page DOM
  function extractPartnerName() {
    // Try common Stips header and conversation title selectors
    const selectors = [
      '.chat_header .user_name',
      '.chat-header h1',
      '.chat-header .name',
      '.messages_header .title',
      '.conversation-header .username',
      'h1.title',
      '.profile_name'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }

    // Fallback: check document title
    const docTitle = document.title;
    if (docTitle && docTitle.includes('-')) {
      const parts = docTitle.split('-');
      if (parts[0].trim()) return parts[0].trim();
    }

    return 'משתמש סטיפס';
  }

  // 3. Inject Button next to /messages/<ID> links on the page
  function injectCandidateLinkButtons() {
    const links = document.querySelectorAll('a[href*="/messages/"]:not([data-stips-download-injected="1"])');

    links.forEach((link) => {
      link.setAttribute('data-stips-download-injected', '1');
      const href = link.getAttribute('href');
      const partnerId = getChatUserId(href);
      if (!partnerId) return;

      const btn = document.createElement('button');
      btn.className = 'stips-download-mini-btn';
      btn.title = 'הורד את השיחה (Stips Download)';
      btn.innerHTML = DOWNLOAD_ICON_SVG;
      btn.type = 'button';

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const nameGuess = link.innerText?.trim() || 'משתמש';
        startDownloadFlow(partnerId, nameGuess);
      });

      // Insert cleanly next to link without disrupting flow
      link.parentNode?.insertBefore(btn, link.nextSibling);
    });
  }

  // Helper to locate the Stips chat green header element
  function findChatHeaderElement() {
    // 1. Angular Material Toolbar or standard chat header classes
    const selectors = [
      'mat-toolbar',
      '.chat_header',
      '.chat-header',
      '.messages_header',
      '.conversation-header',
      '[class*="chat"][class*="header"]',
      '[class*="messages"][class*="header"]',
      '[class*="chat-top"]',
      '[class*="chat_top"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return el;
      }
    }

    // 2. Find 3-dots menu button (⋮ or more_vert) in chat
    const allIcons = document.querySelectorAll('mat-icon, button, span, [role="button"]');
    for (const ic of allIcons) {
      const txt = ic.textContent?.trim() || '';
      if (txt === '⋮' || txt === 'more_vert' || txt === '•••') {
        let parent = ic.parentElement;
        for (let i = 0; i < 4; i++) {
          if (!parent || parent === document.body) break;
          const h = parent.clientHeight;
          if (h >= 35 && h <= 85) {
            return parent;
          }
          parent = parent.parentElement;
        }
      }
    }

    // 3. Find partner name element in chat
    const partnerName = extractPartnerName();
    if (partnerName && partnerName !== 'משתמש סטיפס') {
      const allTextEls = document.querySelectorAll('h1, h2, h3, h4, span, div');
      for (const el of allTextEls) {
        if (el.children.length === 0 && el.textContent?.trim() === partnerName) {
          let parent = el.parentElement;
          for (let i = 0; i < 4; i++) {
            if (!parent || parent === document.body) break;
            const h = parent.clientHeight;
            if (h >= 35 && h <= 85) {
              return { container: parent, nameEl: el };
            }
            parent = parent.parentElement;
          }
        }
      }
    }

    // 4. Modal/Dialog container top child
    const modalBox = document.querySelector('.mat-dialog-container, [role="dialog"], [class*="chat-window"], [class*="chat_window"]');
    if (modalBox && modalBox.firstElementChild) {
      return modalBox.firstElementChild;
    }

    return null;
  }

  // 4. Inject Header Button when inside active chat (directly in the green bar)
  function injectChatHeaderButton() {
    const partnerId = getChatUserId();
    if (!partnerId) return;

    if (document.getElementById('stips-download-header-btn')) return;

    const headerResult = findChatHeaderElement();
    if (!headerResult) return;

    const headerEl = headerResult.container || headerResult;
    const nameEl = headerResult.nameEl || null;

    const headerBtn = document.createElement('button');
    headerBtn.id = 'stips-download-header-btn';
    headerBtn.className = 'stips-download-header-action';
    headerBtn.title = 'הורד את השיחה (Stips Download)';
    headerBtn.type = 'button';
    headerBtn.innerHTML = `
      <span class="stips-dl-icon">${DOWNLOAD_ICON_SVG}</span>
      <span class="stips-dl-text">הורד שיחה</span>
    `;

    headerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = extractPartnerName();
      startDownloadFlow(partnerId, name);
    });

    // If we found the exact name element, insert directly next to the name!
    if (nameEl && nameEl.parentNode) {
      nameEl.parentNode.insertBefore(headerBtn, nameEl.nextSibling);
    } else {
      headerEl.appendChild(headerBtn);
    }
  }

  // 5. Shadow DOM Modal Infrastructure (Defensive against Stips styles)
  function initShadowModal() {
    if (shadowRoot) return;

    const host = document.createElement('div');
    host.id = 'stips-download-shadow-host';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    // Styles for Shadow DOM
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
        --shadow: 0 10px 25px rgba(0,0,0,0.2);
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
      }

      .modal-body {
        padding: 20px;
      }

      .status-text {
        font-size: 14px;
        color: var(--text-main);
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .progress-bar-container {
        height: 10px;
        background: #e9ecef;
        border-radius: 5px;
        overflow: hidden;
        margin-bottom: 16px;
      }

      .progress-bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, var(--primary), #26a69a);
        transition: width 0.3s ease;
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
        font-weight: 600;
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

  function showModal(contentHtml) {
    initShadowModal();
    modalContainer.innerHTML = contentHtml;
    modalContainer.style.display = 'flex';
  }

  function hideModal() {
    if (modalContainer) {
      modalContainer.style.display = 'none';
    }
  }

  // 6. Download Flow Execution (The Core Loop)
  async function startDownloadFlow(partnerId, partnerName) {
    initShadowModal();
    currentPartnerId = Number(partnerId);
    currentPartnerName = partnerName || 'משתמש סטיפס';
    isPaused = false;
    activeAbortController = new AbortController();

    // Check if there is already a checkpoint in IndexedDB
    const existingJob = await getJob(currentPartnerId).catch(() => null);
    const existingMessages = await getMessages(currentPartnerId).catch(() => []);

    let messagesDownloaded = existingMessages.length;
    let cursor = existingJob?.cursor || null;
    let batchesCount = existingJob?.batchesCount || 0;
    let isFirstLoad = !cursor && messagesDownloaded === 0;

    // Render Initial Modal UI
    updateModalUI({
      status: 'מתחבר ל-API של סטיפס...',
      count: messagesDownloaded,
      batches: batchesCount,
      oldestDate: existingMessages[0]?.gregorianDate || 'טרם הורד',
      isCompleted: false,
      isPaused: false
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
          updateModalUI({
            status: 'ההורדה בוטלה על ידי המשתמש.',
            count: messagesDownloaded,
            batches: batchesCount,
            isCompleted: false,
            isCancelled: true
          });
          return;
        }

        // Fetch batch
        updateModalUI({
          status: 'מוריד היסטוריית הודעות...',
          count: messagesDownloaded,
          batches: batchesCount,
          oldestDate: existingMessages[0]?.gregorianDate || 'מעבד...',
          isCompleted: false,
          isPaused: false
        });

        let rawMessages;
        try {
          rawMessages = await fetchMessagesBatch({
            partnerId: currentPartnerId,
            cursor,
            isFirstLoad,
            callerSignal: activeAbortController.signal,
            onRetry: (retryInfo) => {
              updateModalUI({
                status: retryInfo.message,
                count: messagesDownloaded,
                batches: batchesCount,
                isCompleted: false,
                isRetrying: true
              });
            }
          });
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') return;
          throw fetchErr;
        }

        // Stop condition 1: empty messages returned
        if (!rawMessages || rawMessages.length === 0) {
          console.log('No more messages returned by API. Download complete.');
          break;
        }

        // Normalize and parse messages
        const normalizedBatch = [];
        let minIdInBatch = null;

        for (const raw of rawMessages) {
          const norm = normalizeApiMessage(raw, currentPartnerId, currentPartnerName);
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

        // If no new messages were added and we already had a cursor, we reached the end
        if (normalizedBatch.length === 0 && cursor !== null) {
          console.log('No new unique messages in batch. Download reached beginning of chat.');
          break;
        }

        // Save batch to IndexedDB checkpoint immediately!
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

        // UI progress update
        updateModalUI({
          status: 'מוריד ומאמת הודעות...',
          count: messagesDownloaded,
          batches: batchesCount,
          oldestDate: normalizedBatch[0]?.gregorianDate || 'בתהליך...',
          isCompleted: false,
          isPaused: false
        });

        // Small defensive delay to remain gentle on Stips API
        await new Promise((r) => setTimeout(r, 200));
      }

      // Finalization & Validation
      const report = await getValidationReport(currentPartnerId);

      // Save completed job
      await saveJob({
        partnerId: currentPartnerId,
        partnerName: currentPartnerName,
        cursor,
        messagesDownloaded: report.total,
        batchesCount,
        status: 'completed'
      });

      // Show Completion UI
      updateModalUI({
        status: 'ההורדה הושלמה בהצלחה!',
        count: report.total,
        batches: batchesCount,
        oldestDate: report.oldestDate || 'אין תאריך',
        isCompleted: true,
        report
      });
    } catch (err) {
      console.error('Download error:', err);
      updateModalUI({
        status: `שגיאה בהורדה: ${err.message}`,
        count: messagesDownloaded,
        batches: batchesCount,
        isCompleted: false,
        isError: true
      });
    }
  }

  // 7. Update Modal UI Content
  function updateModalUI(state) {
    if (!modalContainer) return;

    let bodyHtml = '';

    if (state.isCompleted) {
      const rep = state.report || {};
      const warningHtml =
        rep.undatedCount > 0
          ? `<div class="warning-banner">שים לב: ${rep.undatedCount} הודעות ירדו ללא חותמת זמן תקינה.</div>`
          : '';

      bodyHtml = `
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title">
              <span>✓ שיחת ${currentPartnerName} נשמרה</span>
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
                <span class="stat-val">${state.count.toLocaleString('he-IL')}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">סבבי API</span>
                <span class="stat-val">${state.batches}</span>
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
              <button class="btn btn-primary" id="btn-modal-open-archive">🚀 פתח ארכיון</button>
              <button class="btn" id="btn-modal-download-html">הורד קובץ HTML</button>
              <button class="btn" id="btn-modal-download-json">JSON</button>
              <button class="btn" id="btn-modal-download-txt">TXT</button>
            </div>
          </div>
        </div>
      `;
    } else {
      // In progress / Paused UI
      const pauseBtnText = isPaused ? '▶ המשך הורדה' : '⏸ השהה';
      bodyHtml = `
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title">
              <span>מוריד שיחה עם ${currentPartnerName}</span>
            </div>
            <button class="close-btn" id="modal-close-x">✕</button>
          </div>
          <div class="modal-body">
            <div class="status-text">${state.status}</div>

            <div class="progress-bar-container">
              <div class="progress-bar" style="width: 100%;"></div>
            </div>

            <div class="stats-grid">
              <div class="stat-item">
                <span class="stat-label">הודעות שהורדו</span>
                <span class="stat-val">${state.count.toLocaleString('he-IL')}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">סבבי API</span>
                <span class="stat-val">${state.batches}</span>
              </div>
            </div>

            <div class="modal-actions">
              <button class="btn" id="btn-modal-pause">${pauseBtnText}</button>
              <button class="btn btn-danger" id="btn-modal-cancel">ביטול</button>
              <button class="btn" id="btn-modal-export-partial">ייצא ארכיון ביניים</button>
            </div>
          </div>
        </div>
      `;
    }

    modalContainer.innerHTML = bodyHtml;
    modalContainer.style.display = 'flex';

    // Bind actions
    modalContainer.querySelector('#modal-close-x')?.addEventListener('click', hideModal);

    modalContainer.querySelector('#btn-modal-pause')?.addEventListener('click', () => {
      isPaused = !isPaused;
      updateModalUI({
        ...state,
        status: isPaused ? 'ההורדה הושהתה. תוכל להמשיך בכל שלב.' : 'ממשיך הורדה...',
        isPaused
      });
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

    modalContainer.querySelector('#btn-modal-open-archive')?.addEventListener('click', async () => {
      await handleOpenArchiveInTab();
    });

    modalContainer.querySelector('#btn-modal-download-html')?.addEventListener('click', async () => {
      await handleExportAction('html');
    });

    modalContainer.querySelector('#btn-modal-download-json')?.addEventListener('click', async () => {
      await handleExportAction('json');
    });

    modalContainer.querySelector('#btn-modal-download-txt')?.addEventListener('click', async () => {
      await handleExportAction('txt');
    });
  }

  // 8. Handle Exports & Open in Tab
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
        metadata: { partnerId: currentPartnerId, partnerName: currentPartnerName },
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
      metadata: { partnerId: currentPartnerId, partnerName: currentPartnerName },
      messages
    });

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
  }

  // 9. SPA Navigation and URL Watcher
  function checkUrlAndInject() {
    injectCandidateLinkButtons();
    if (getChatUserId()) {
      injectChatHeaderButton();
    }
  }

  // Hook history pushState and replaceState for instant SPA reactivity
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  history.pushState = function (...args) {
    origPushState.apply(this, args);
    setTimeout(checkUrlAndInject, 100);
  };

  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    setTimeout(checkUrlAndInject, 100);
  };

  window.addEventListener('popstate', () => {
    setTimeout(checkUrlAndInject, 100);
  });

  // Debounced MutationObserver for dynamic page renders
  let mutationTimeout = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(checkUrlAndInject, 350);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial Run
  checkUrlAndInject();
})();
