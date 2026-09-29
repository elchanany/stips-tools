/**
 * Stips Download - Popup Script
 * Detects current tab context, triggers downloads, and manages saved local archives.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const contextDot = document.getElementById('context-dot');
  const contextTitle = document.getElementById('context-title');
  const contextDesc = document.getElementById('context-desc');
  const contextActions = document.getElementById('context-actions');
  const btnDownload = document.getElementById('btn-popup-download');
  const savedList = document.getElementById('saved-list');
  const savedCount = document.getElementById('saved-count');

  let activeTab = null;
  let activePartnerId = null;

  // 1. Detect Active Tab Context
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTab = tabs[0];
      const url = activeTab.url || '';
      const match = url.match(/stips\.co\.il\/messages\/(\d+)/);

      if (match) {
        activePartnerId = Number(match[1]);
        contextDot.className = 'card-status-dot active';
        contextTitle.innerText = `שיחה פעילה (${activePartnerId})`;
        contextDesc.innerText = 'מזוהה עמוד צ׳אט. לחץ להורדה מלאה:';
        contextActions.style.display = 'flex';
      } else if (url.includes('stips.co.il')) {
        contextDot.className = 'card-status-dot';
        contextTitle.innerText = 'נמצא באתר סטיפס';
        contextDesc.innerText = 'פתח שיחה ב-Stips כדי להוריד אותה.';
        contextActions.style.display = 'none';
      } else {
        contextDot.className = 'card-status-dot';
        contextTitle.innerText = 'לא בעמוד סטיפס';
        contextDesc.innerText = 'גלוש ל-stips.co.il כדי להשתמש בתוסף.';
        contextActions.style.display = 'none';
      }
    }
  } catch (err) {
    console.warn('Error querying tab:', err);
  }

  // 2. Click "Download Chat" in Popup
  btnDownload?.addEventListener('click', async () => {
    if (!activeTab || !activePartnerId) return;

    // Trigger download in content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: (partnerId) => {
          const btn = document.getElementById('stips-download-header-btn');
          if (btn) {
            btn.click();
          } else {
            console.warn('Stips download button not found');
          }
        },
        args: [activePartnerId]
      });
      window.close(); // Close popup so user sees the modal on page
    } catch (e) {
      console.error('Error triggering download via popup:', e);
    }
  });

  // 3. Load Saved Archives from IndexedDB
  async function loadSavedArchives() {
    try {
      const convs = await getAllConversations();
      savedCount.innerText = convs.length;

      if (!convs || convs.length === 0) {
        savedList.innerHTML = '<div class="empty-list">אין שיחות שמורות במאגר המקומי.</div>';
        return;
      }

      savedList.innerHTML = '';
      convs.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'saved-item';

        const dateFormatted = c.lastDownloadedAt ? new Date(c.lastDownloadedAt).toLocaleDateString('he-IL') : '';

        item.innerHTML = `
          <div class="saved-item-info">
            <span class="saved-item-name">${c.partnerName || 'משתמש'} (${c.partnerId})</span>
            <span class="saved-item-meta">${c.totalMessages || 0} הודעות &bull; ${dateFormatted}</span>
          </div>
          <div class="saved-item-actions">
            <button class="icon-btn" title="פתח ארכיון" data-action="open" data-id="${c.partnerId}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
            <button class="icon-btn danger" title="מחק נתונים שמורים" data-action="delete" data-id="${c.partnerId}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;

        item.querySelector('[data-action="open"]')?.addEventListener('click', async () => {
          const msgs = await getMessages(c.partnerId);
          const html = buildArchiveHtml({
            metadata: { partnerId: c.partnerId, partnerName: c.partnerName },
            messages: msgs
          });
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          chrome.tabs.create({ url });
        });

        item.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
          if (confirm(`האם למחוק את נתוני השיחה השמורה של ${c.partnerName}?`)) {
            await clearPartnerData(c.partnerId);
            loadSavedArchives();
          }
        });

        savedList.appendChild(item);
      });
    } catch (err) {
      console.warn('Error loading saved archives:', err);
    }
  }

  loadSavedArchives();
});
