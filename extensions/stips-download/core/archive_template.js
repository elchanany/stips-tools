/**
 * Stips Download - Standalone Offline HTML Archive Generator
 * Zero dependencies, single file, fully offline, virtualized, fast in-memory search,
 * dual Hebrew/Gregorian calendar jump, and Telegram-style date separators and floating chip.
 */

function generateArchiveAppFunction() {
  return function archiveApp() {
    // 1. Load Data
    const rawDataEl = document.getElementById('archive-data');
    if (!rawDataEl) return;
    const ARCHIVE = JSON.parse(rawDataEl.textContent);
    const MESSAGES = ARCHIVE.messages || [];
    const TOTAL = MESSAGES.length;

    // Normalization helper for search and Hebrew comparison
    function normalize(val) {
      return String(val || '')
        .normalize('NFKD')
        .replace(/[\u0591-\u05C7]/g, '')
        .toLocaleLowerCase('he-IL')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Precompute date index and calendar maps
    const DATE_INFO = new Array(TOTAL);
    const DATES_MAP = new Map(); // dateKey -> first message index
    const HEBREW_DATES_MAP = new Map(); // hebrewDate -> first message index

    for (let i = 0; i < TOTAL; i++) {
      const m = MESSAGES[i];
      const key = m.dateKey || '';
      const dInfo = {
        key,
        gregorian: m.gregorianDate || '',
        hebrew: m.hebrewDate || '',
        time: m.time || ''
      };
      DATE_INFO[i] = dInfo;

      if (key && !DATES_MAP.has(key)) {
        DATES_MAP.set(key, i);
      }
      if (m.hebrewDate && !HEBREW_DATES_MAP.has(m.hebrewDate)) {
        HEBREW_DATES_MAP.set(m.hebrewDate, i);
      }
    }

    // Precompute Search Index: normalized texts
    const SEARCH_INDEX = new Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) {
      SEARCH_INDEX[i] = normalize(MESSAGES[i].text);
    }

    // Levenshtein / 1-typo fuzzy match helper
    function isFuzzyMatch(needle, haystack) {
      if (!needle || !haystack) return false;
      if (haystack.includes(needle)) return true;
      if (needle.length < 4) return false;

      // Check each word in haystack
      const words = haystack.split(' ');
      for (const w of words) {
        if (w.startsWith(needle) || needle.startsWith(w)) return true;
        if (Math.abs(w.length - needle.length) <= 1 && w.length >= 4) {
          let diffs = 0;
          const minLen = Math.min(w.length, needle.length);
          for (let c = 0; c < minLen; c++) {
            if (w[c] !== needle[c]) {
              diffs++;
              if (diffs > 1) break;
            }
          }
          if (diffs <= 1) return true;
        }
      }
      return false;
    }

    // DOM Elements
    const chatContainer = document.getElementById('chat-container');
    const messagesWrapper = document.getElementById('messages-wrapper');
    const floatingDate = document.getElementById('floating-date');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const calendarModal = document.getElementById('calendar-modal');
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const statsBadge = document.getElementById('stats-badge');

    // Virtualization State
    const BEFORE = 30;
    const AFTER = 30;
    const SHIFT = 20;

    let center = Math.max(0, TOTAL - 1); // Start at newest message
    let viewStart = 0;
    let viewEnd = 0;
    let isRendering = false;

    // Render Window
    function renderVirtualWindow(targetAnchorId = null, preserveScroll = false) {
      if (TOTAL === 0) {
        messagesWrapper.innerHTML = '<div class="empty-state">אין הודעות להצגה בארכיון זה.</div>';
        return;
      }

      isRendering = true;

      // Record anchor position before modifying DOM if preserving scroll
      let anchorEl = null;
      let anchorTopBefore = 0;
      if (preserveScroll && messagesWrapper.firstElementChild) {
        anchorEl = messagesWrapper.querySelector('.msg-bubble');
        if (anchorEl) {
          anchorTopBefore = anchorEl.getBoundingClientRect().top;
        }
      }

      viewStart = Math.max(0, center - BEFORE);
      viewEnd = Math.min(TOTAL, center + AFTER + 1);

      const fragment = document.createDocumentFragment();

      // Top spacer
      const topSpacerHeight = viewStart * 64;
      const topSpacer = document.createElement('div');
      topSpacer.className = 'virtual-spacer';
      topSpacer.style.height = topSpacerHeight + 'px';
      fragment.appendChild(topSpacer);

      // Telegram date separator logic
      let previousDate = viewStart > 0 ? DATE_INFO[viewStart - 1]?.key : null;

      for (let i = viewStart; i < viewEnd; i++) {
        const msg = MESSAGES[i];
        const dateInfo = DATE_INFO[i];

        // Date Separator if day changed
        if (dateInfo?.key && dateInfo.key !== previousDate) {
          const sep = document.createElement('div');
          sep.className = 'date-separator';
          sep.setAttribute('data-date-key', dateInfo.key);
          sep.innerHTML = `<span>${dateInfo.gregorian} &bull; ${dateInfo.hebrew}</span>`;
          fragment.appendChild(sep);
          previousDate = dateInfo.key;
        }

        // Message Bubble
        const bubble = document.createElement('div');
        bubble.className = `msg-row ${msg.side === 'me' ? 'me' : 'other'}`;
        bubble.id = `msg-${msg.id}`;
        bubble.setAttribute('data-index', i);

        // Escape text safely
        const textSpan = document.createElement('span');
        textSpan.className = 'msg-text';
        textSpan.innerText = msg.text;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'msg-time';
        timeSpan.innerText = msg.time || '';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'msg-meta';
        metaDiv.appendChild(timeSpan);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'msg-bubble';

        if (msg.side !== 'me') {
          const senderDiv = document.createElement('div');
          senderDiv.className = 'msg-sender';
          senderDiv.innerText = msg.sender || ARCHIVE.partnerName || 'משתמש';
          contentDiv.appendChild(senderDiv);
        }

        contentDiv.appendChild(textSpan);
        contentDiv.appendChild(metaDiv);
        bubble.appendChild(contentDiv);
        fragment.appendChild(bubble);
      }

      // Bottom spacer
      const bottomSpacerHeight = (TOTAL - viewEnd) * 64;
      const bottomSpacer = document.createElement('div');
      bottomSpacer.className = 'virtual-spacer';
      bottomSpacer.style.height = bottomSpacerHeight + 'px';
      fragment.appendChild(bottomSpacer);

      // Replace DOM
      messagesWrapper.innerHTML = '';
      messagesWrapper.appendChild(fragment);

      // Restore scroll anchor or jump to target
      if (targetAnchorId) {
        const el = document.getElementById(targetAnchorId);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' });
          el.querySelector('.msg-bubble')?.classList.add('highlight-flash');
          setTimeout(() => {
            el.querySelector('.msg-bubble')?.classList.remove('highlight-flash');
          }, 2000);
        }
      } else if (preserveScroll && anchorEl) {
        const anchorAfter = document.getElementById(anchorEl.closest('.msg-row')?.id);
        if (anchorAfter) {
          const diff = anchorAfter.getBoundingClientRect().top - anchorTopBefore;
          chatContainer.scrollTop += diff;
        }
      }

      updateFloatingDate();
      isRendering = false;
    }

    // Floating Date update
    function updateFloatingDate() {
      const rows = messagesWrapper.querySelectorAll('.msg-row');
      const containerRect = chatContainer.getBoundingClientRect();
      let topMsgDate = null;

      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom >= containerRect.top + 20) {
          const idx = parseInt(row.getAttribute('data-index'), 10);
          if (!isNaN(idx) && DATE_INFO[idx]) {
            topMsgDate = DATE_INFO[idx];
          }
          break;
        }
      }

      if (topMsgDate && topMsgDate.gregorian) {
        floatingDate.style.display = 'block';
        floatingDate.innerText = `${topMsgDate.gregorian} | ${topMsgDate.hebrew}`;
      } else if (DATE_INFO[center]) {
        floatingDate.style.display = 'block';
        floatingDate.innerText = `${DATE_INFO[center].gregorian} | ${DATE_INFO[center].hebrew}`;
      }
    }

    // Scroll Handler (virtual pagination)
    let scrollTimeout = null;
    chatContainer.addEventListener('scroll', () => {
      updateFloatingDate();

      if (isRendering) return;

      const scrollTop = chatContainer.scrollTop;
      const scrollHeight = chatContainer.scrollHeight;
      const clientHeight = chatContainer.clientHeight;

      // Scrolling up
      if (scrollTop < 400 && viewStart > 0) {
        center = Math.max(0, center - SHIFT);
        renderVirtualWindow(null, true);
      }
      // Scrolling down
      else if (scrollHeight - (scrollTop + clientHeight) < 400 && viewEnd < TOTAL) {
        center = Math.min(TOTAL - 1, center + SHIFT);
        renderVirtualWindow(null, true);
      }
    });

    // Jump to index
    function jumpToIndex(idx) {
      if (idx < 0) idx = 0;
      if (idx >= TOTAL) idx = TOTAL - 1;
      center = idx;
      const targetId = `msg-${MESSAGES[idx].id}`;
      renderVirtualWindow(targetId);
    }

    // Jump buttons
    document.getElementById('btn-jump-start')?.addEventListener('click', () => jumpToIndex(0));
    document.getElementById('btn-jump-end')?.addEventListener('click', () => jumpToIndex(TOTAL - 1));

    // Copy buttons
    document.getElementById('btn-copy-visible')?.addEventListener('click', () => {
      const visibleRows = messagesWrapper.querySelectorAll('.msg-row');
      let text = '';
      visibleRows.forEach((row) => {
        const sender = row.querySelector('.msg-sender')?.innerText || 'אני';
        const msgText = row.querySelector('.msg-text')?.innerText || '';
        const time = row.querySelector('.msg-time')?.innerText || '';
        text += `[${time}] ${sender}: ${msgText}\n`;
      });
      navigator.clipboard.writeText(text).then(() => alert('ההודעות המוצגות הועתקו ללוח!'));
    });

    document.getElementById('btn-copy-all')?.addEventListener('click', () => {
      let text = '';
      for (const m of MESSAGES) {
        text += `[${m.gregorianDate} | ${m.hebrewDate} | ${m.time}] ${m.sender}: ${m.text}\n`;
      }
      navigator.clipboard.writeText(text).then(() => alert('כל השיחה הועתקה ללוח!'));
    });

    // JSON & TXT Export Download directly from offline viewer
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(ARCHIVE, null, 2)], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stips_${ARCHIVE.partnerName || 'chat'}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    });

    document.getElementById('btn-export-txt')?.addEventListener('click', () => {
      let text = `ארכיון שיחת סטיפס עם ${ARCHIVE.partnerName || 'משתמש'} (${ARCHIVE.partnerId})\n`;
      text += `סך הודעות: ${TOTAL}\n`;
      text += `הופק בתאריך: ${new Date().toLocaleString('he-IL')}\n\n`;
      for (const m of MESSAGES) {
        text += `[${m.gregorianDate} | ${m.hebrewDate} | ${m.time}] ${m.sender}: ${m.text}\n`;
      }
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stips_${ARCHIVE.partnerName || 'chat'}_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
    });

    // In-memory Fast Search
    let searchDebounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        const query = normalize(searchInput.value);
        if (!query || query.length < 2) {
          searchResults.style.display = 'none';
          searchResults.innerHTML = '';
          return;
        }

        const matches = [];
        for (let i = 0; i < TOTAL; i++) {
          const normText = SEARCH_INDEX[i];
          if (normText.includes(query) || isFuzzyMatch(query, normText)) {
            matches.push(i);
            if (matches.length >= 60) break; // Limit dropdown to top 60
          }
        }

        if (matches.length === 0) {
          searchResults.innerHTML = '<div class="search-empty">לא נמצאו תוצאות מתאימות.</div>';
          searchResults.style.display = 'block';
          return;
        }

        const frag = document.createDocumentFragment();
        matches.forEach((idx) => {
          const m = MESSAGES[idx];
          const item = document.createElement('div');
          item.className = 'search-item';

          // Highlight matching snippet
          const origText = m.text;
          const reg = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          const highlighted = origText.replace(reg, '<mark>$1</mark>');

          item.innerHTML = `
            <div class="search-item-header">
              <span class="search-sender">${m.sender}</span>
              <span class="search-date">${m.gregorianDate} &bull; ${m.hebrewDate} &bull; ${m.time}</span>
            </div>
            <div class="search-snippet">${highlighted}</div>
          `;

          item.addEventListener('click', () => {
            searchResults.style.display = 'none';
            jumpToIndex(idx);
          });
          frag.appendChild(item);
        });

        searchResults.innerHTML = '';
        searchResults.appendChild(frag);
        searchResults.style.display = 'block';
      }, 150);
    });

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none';
      }
    });

    // Calendar Picker Modal
    const btnOpenCalendar = document.getElementById('btn-calendar');
    const closeCalendarBtn = document.getElementById('close-calendar');
    const calendarViewGregorian = document.getElementById('cal-view-gregorian');
    const calendarViewHebrew = document.getElementById('cal-view-hebrew');
    const tabGregorian = document.getElementById('tab-cal-gregorian');
    const tabHebrew = document.getElementById('tab-cal-hebrew');

    btnOpenCalendar?.addEventListener('click', () => {
      renderCalendar();
      calendarModal.style.display = 'flex';
    });

    closeCalendarBtn?.addEventListener('click', () => {
      calendarModal.style.display = 'none';
    });

    tabGregorian?.addEventListener('click', () => {
      tabGregorian.classList.add('active');
      tabHebrew.classList.remove('active');
      calendarViewGregorian.style.display = 'block';
      calendarViewHebrew.style.display = 'none';
    });

    tabHebrew?.addEventListener('click', () => {
      tabHebrew.classList.add('active');
      tabGregorian.classList.remove('active');
      calendarViewGregorian.style.display = 'none';
      calendarViewHebrew.style.display = 'block';
    });

    function renderCalendar() {
      // 1. Gregorian List of active dates
      calendarViewGregorian.innerHTML = '';
      const gList = document.createElement('div');
      gList.className = 'cal-dates-list';

      // Sort dates
      const sortedDates = Array.from(DATES_MAP.keys()).sort();
      if (sortedDates.length === 0) {
        gList.innerHTML = '<div class="empty-state">אין תאריכים זמינים</div>';
      } else {
        sortedDates.forEach((key) => {
          const idx = DATES_MAP.get(key);
          const dInfo = DATE_INFO[idx];
          const btn = document.createElement('button');
          btn.className = 'cal-date-btn';
          btn.innerHTML = `
            <span class="cal-d-greg">${dInfo.gregorian}</span>
            <span class="cal-d-heb">${dInfo.hebrew}</span>
          `;
          btn.addEventListener('click', () => {
            calendarModal.style.display = 'none';
            jumpToIndex(idx);
          });
          gList.appendChild(btn);
        });
      }
      calendarViewGregorian.appendChild(gList);

      // 2. Hebrew List of active dates
      calendarViewHebrew.innerHTML = '';
      const hList = document.createElement('div');
      hList.className = 'cal-dates-list';

      sortedDates.forEach((key) => {
        const idx = DATES_MAP.get(key);
        const dInfo = DATE_INFO[idx];
        const btn = document.createElement('button');
        btn.className = 'cal-date-btn';
        btn.innerHTML = `
          <span class="cal-d-heb-big">${dInfo.hebrew}</span>
          <span class="cal-d-sub">${dInfo.gregorian}</span>
        `;
        btn.addEventListener('click', () => {
          calendarModal.style.display = 'none';
          jumpToIndex(idx);
        });
        hList.appendChild(btn);
      });
      calendarViewHebrew.appendChild(hList);
    }

    // Dark / Light Theme Toggle
    const currentTheme = localStorage.getItem('stips_archive_theme') || 'light';
    if (currentTheme === 'dark') {
      document.body.classList.add('dark');
      themeToggleBtn.innerText = '☀️ מצב בהיר';
    } else {
      themeToggleBtn.innerText = '🌙 מצב כהה';
    }

    themeToggleBtn?.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      localStorage.setItem('stips_archive_theme', isDark ? 'dark' : 'light');
      themeToggleBtn.innerText = isDark ? '☀️ מצב בהיר' : '🌙 מצב כהה';
    });

    // Initialize!
    if (statsBadge) {
      statsBadge.innerText = `${TOTAL.toLocaleString('he-IL')} הודעות`;
    }
    renderVirtualWindow();
    chatContainer.scrollTop = chatContainer.scrollHeight;
  };
}

/**
 * Builds the complete standalone HTML archive string
 */
function buildArchiveHtml({ metadata, messages }) {
  const dataPayload = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    partnerId: metadata?.partnerId || 0,
    partnerName: metadata?.partnerName || 'שיחה',
    messages: messages || []
  };

  // Convert app code to self-invoking function string safely
  const appFunction = generateArchiveAppFunction();
  const appSource = '(' + appFunction.toString() + ')();';

  // Safely serialize JSON data without breaking script tags
  const jsonString = JSON.stringify(dataPayload).replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>ארכיון שיחה - ${dataPayload.partnerName} | Stips Download</title>
  <style>
    :root {
      --bg-primary: #f0f2f5;
      --bg-surface: #ffffff;
      --bg-header: #ffffff;
      --border-color: #e4e6eb;
      --text-primary: #1c1e21;
      --text-secondary: #65676b;
      --text-muted: #8a8d91;
      --accent: #009688;
      --accent-hover: #00796b;
      --bubble-me: #dcf8c6;
      --bubble-me-text: #111111;
      --bubble-other: #ffffff;
      --bubble-other-text: #111111;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.08);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
      --radius-bubble: 16px;
      --radius-sm: 8px;
    }

    body.dark {
      --bg-primary: #0f1416;
      --bg-surface: #1e2428;
      --bg-header: #1e2428;
      --border-color: #2a3237;
      --text-primary: #e9edef;
      --text-secondary: #8696a0;
      --text-muted: #667781;
      --accent: #26a69a;
      --accent-hover: #4db6ac;
      --bubble-me: #005c4b;
      --bubble-me-text: #e9edef;
      --bubble-other: #202c33;
      --bubble-other-text: #e9edef;
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
      --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Header */
    header {
      background: var(--bg-header);
      border-bottom: 1px solid var(--border-color);
      padding: 10px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-shadow: var(--shadow-sm);
      z-index: 100;
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      font-weight: bold;
    }

    .header-titles h1 {
      font-size: 16px;
      font-weight: 600;
    }

    .header-titles .stats {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    button {
      background: var(--bg-surface);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 6px 12px;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    button:hover {
      background: var(--border-color);
    }

    button.primary {
      background: var(--accent);
      color: #ffffff;
      border-color: var(--accent);
    }

    button.primary:hover {
      background: var(--accent-hover);
    }

    /* Search Box */
    .search-wrapper {
      position: relative;
      flex: 1;
      max-width: 320px;
    }

    .search-input {
      width: 100%;
      padding: 7px 12px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 13px;
      outline: none;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .search-results {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-md);
      max-height: 380px;
      overflow-y: auto;
      z-index: 200;
      display: none;
    }

    .search-item {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border-color);
      cursor: pointer;
      font-size: 13px;
    }

    .search-item:hover {
      background: var(--border-color);
    }

    .search-item-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .search-sender {
      font-weight: 600;
      color: var(--accent);
    }

    .search-snippet mark {
      background: #ffeb3b;
      color: #000;
      border-radius: 2px;
      padding: 0 2px;
    }

    .search-empty {
      padding: 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    /* Floating Date Chip */
    .floating-date-container {
      position: absolute;
      top: 66px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 90;
    }

    .floating-date-chip {
      background: rgba(30, 36, 40, 0.85);
      color: #ffffff;
      font-size: 12px;
      padding: 4px 14px;
      border-radius: 14px;
      box-shadow: var(--shadow-sm);
      backdrop-filter: blur(4px);
    }

    body.dark .floating-date-chip {
      background: rgba(42, 50, 55, 0.9);
    }

    /* Chat Area */
    #chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      position: relative;
    }

    #messages-wrapper {
      max-width: 860px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
    }

    .virtual-spacer {
      width: 100%;
    }

    /* Telegram-style Date Separator */
    .date-separator {
      display: flex;
      justify-content: center;
      margin: 16px 0 12px;
    }

    .date-separator span {
      background: var(--bg-surface);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      padding: 4px 16px;
      border-radius: 12px;
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--border-color);
    }

    /* Message Rows */
    .msg-row {
      display: flex;
      margin-bottom: 6px;
      width: 100%;
    }

    .msg-row.me {
      justify-content: flex-start; /* in RTL, 'me' aligns to the right / start */
    }

    .msg-row.other {
      justify-content: flex-end; /* in RTL, 'other' aligns to the left / end */
    }

    .msg-bubble {
      max-width: 72%;
      padding: 8px 12px;
      border-radius: var(--radius-bubble);
      box-shadow: var(--shadow-sm);
      position: relative;
      word-break: break-word;
      line-height: 1.45;
      font-size: 14px;
      transition: background 0.3s;
    }

    .msg-row.me .msg-bubble {
      background: var(--bubble-me);
      color: var(--bubble-me-text);
      border-bottom-right-radius: 4px;
    }

    .msg-row.other .msg-bubble {
      background: var(--bubble-other);
      color: var(--bubble-other-text);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--border-color);
    }

    .msg-sender {
      font-size: 11px;
      font-weight: 600;
      color: var(--accent);
      margin-bottom: 2px;
    }

    .msg-text {
      white-space: pre-wrap;
    }

    .msg-meta {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 4px;
      margin-top: 4px;
      font-size: 10px;
      color: var(--text-muted);
    }

    .highlight-flash {
      animation: flashBorder 2s ease;
    }

    @keyframes flashBorder {
      0% { box-shadow: 0 0 0 3px #ff9800; }
      100% { box-shadow: var(--shadow-sm); }
    }

    /* Calendar Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 300;
    }

    .modal-card {
      background: var(--bg-surface);
      border-radius: 12px;
      box-shadow: var(--shadow-md);
      width: 90%;
      max-width: 520px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .modal-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-primary);
    }

    .modal-tab {
      flex: 1;
      padding: 10px;
      text-align: center;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      border-bottom: 2px solid transparent;
    }

    .modal-tab.active {
      border-bottom-color: var(--accent);
      color: var(--accent);
      background: var(--bg-surface);
    }

    .modal-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    .cal-dates-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .cal-date-btn {
      width: 100%;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-align: right;
      border-radius: 8px;
    }

    .cal-d-greg {
      font-weight: 600;
    }

    .cal-d-heb {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .cal-d-heb-big {
      font-size: 14px;
      font-weight: 600;
    }

    .cal-d-sub {
      font-size: 12px;
      color: var(--text-secondary);
    }

    @media (max-width: 768px) {
      header {
        flex-direction: column;
        align-items: stretch;
      }
      .search-wrapper {
        max-width: 100%;
      }
      .msg-bubble {
        max-width: 88%;
      }
    }
  </style>
</head>
<body>

  <header>
    <div class="header-info">
      <div class="avatar">${(dataPayload.partnerName || 'S').slice(0, 1)}</div>
      <div class="header-titles">
        <h1>שיחה עם ${dataPayload.partnerName}</h1>
        <div class="stats" id="stats-badge">${dataPayload.messages.length} הודעות</div>
      </div>
    </div>

    <div class="search-wrapper">
      <input type="text" class="search-input" id="search-input" placeholder="חיפוש בשיחה..." autocomplete="off">
      <div class="search-results" id="search-results"></div>
    </div>

    <div class="header-actions">
      <button id="btn-jump-start" title="לתחילת השיחה">⏮ התחלה</button>
      <button id="btn-jump-end" title="לסוף השיחה">סוף ⏭</button>
      <button id="btn-calendar" class="primary" title="לוח שנה">📅 תאריך</button>
      <button id="btn-copy-visible" title="העתק מוצגות">העתק מוצגות</button>
      <button id="btn-copy-all" title="העתק הכל">העתק הכל</button>
      <button id="btn-export-json" title="שמור JSON">JSON</button>
      <button id="btn-export-txt" title="שמור TXT">TXT</button>
      <button id="theme-toggle-btn" title="שנה ערכת נושא">🌙 מצב כהה</button>
    </div>
  </header>

  <div class="floating-date-container">
    <div class="floating-date-chip" id="floating-date" style="display: none;"></div>
  </div>

  <main id="chat-container">
    <div id="messages-wrapper"></div>
  </main>

  <!-- Calendar Picker Modal -->
  <div class="modal-overlay" id="calendar-modal">
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="font-size: 15px;">קפיצה לפי תאריך</h3>
        <button id="close-calendar" style="padding: 4px 8px;">✕</button>
      </div>
      <div class="modal-tabs">
        <div class="modal-tab active" id="tab-cal-gregorian">לוח לועזי</div>
        <div class="modal-tab" id="tab-cal-hebrew">לוח עברי</div>
      </div>
      <div class="modal-body">
        <div id="cal-view-gregorian"></div>
        <div id="cal-view-hebrew" style="display: none;"></div>
      </div>
    </div>
  </div>

  <!-- Raw Archive Data -->
  <script id="archive-data" type="application/json">
${jsonString}
  </script>

  <!-- Standalone Application Script -->
  <script>
${appSource}
  </script>
</body>
</html>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateArchiveAppFunction,
    buildArchiveHtml
  };
}
