/**
 * Stips Download - Background Service Worker (Manifest V3)
 * Handles file downloads, opening offline archives in tabs, and background state coordination.
 */

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Stips Download extension installed/updated:', details.reason);
});

// Message listener for communication between content scripts, popup, and background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'DOWNLOAD_FILE') {
    handleFileDownload(request)
      .then((res) => sendResponse({ success: true, res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'OPEN_ARCHIVE_TAB') {
    handleOpenArchive(request)
      .then((res) => sendResponse({ success: true, res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleFileDownload({ filename, data, mimeType }) {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });

  return { downloadId };
}

async function handleOpenArchive({ htmlContent }) {
  // Use data URI or blob URL to open self-contained offline viewer in a new tab
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const tab = await chrome.tabs.create({ url });
  return { tabId: tab.id };
}
