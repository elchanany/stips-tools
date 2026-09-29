/**
 * Stips Download - Exporter Module
 * Creates HTML, JSON, and TXT files and handles downloading via chrome.downloads or Blob URL.
 */

/**
 * Sanitizes filename for safe disk storage
 */
function sanitizeFilename(name) {
  return String(name || 'chat')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

/**
 * Generates formatted TXT string
 */
function generateTxtContent(partnerName, partnerId, messages) {
  let out = `ארכיון שיחת סטיפס עם ${partnerName || 'משתמש'} (${partnerId})\n`;
  out += `סך הודעות: ${messages.length}\n`;
  out += `הופק בתאריך: ${new Date().toLocaleString('he-IL')}\n`;
  out += `==================================================\n\n`;

  for (const m of messages) {
    const greg = m.gregorianDate || '';
    const heb = m.hebrewDate || '';
    const time = m.time || '';
    const sender = m.sender || (m.side === 'me' ? 'אני' : partnerName);
    out += `[${greg} | ${heb} | ${time}] ${sender}: ${m.text}\n\n`;
  }

  return out;
}

/**
 * Triggers download of a Blob using chrome.downloads or <a> fallback
 */
async function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);

  if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
    try {
      await chrome.downloads.download({
        url,
        filename,
        saveAs: true
      });
      return { success: true, filename };
    } catch (err) {
      console.warn('chrome.downloads failed, falling back to <a>:', err);
    }
  }

  // Fallback
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 3000);

  return { success: true, filename };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeFilename,
    generateTxtContent,
    triggerFileDownload
  };
}
