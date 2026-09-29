// Stips Enhancer - Service Worker v2.0
console.log("🔧 Stips Notifie Service Worker v2.0 started!");

// אתחול ברירות מחדל בהתקנה
chrome.runtime.onInstalled.addListener((details) => {
    console.log("📦 Extension installed/updated:", details.reason);
    
    // הגדרת ערכי ברירת מחדל
    const defaultSettings = {
        enableReplyButton: true,
        quoteFormatStart: '"',
        quoteFormatEnd: '"',
        quoteSeparator: ' ↶ ',
        enableChatMessages: true,
        enableSystemMessages: true,
        enableDarkMode: false
    };
    
    chrome.storage.sync.set(defaultSettings, () => {
        console.log("✅ Default settings initialized:", defaultSettings);
    });
    
    // הצגת הודעת התקנה
    if (details.reason === 'install') {
        console.log("🎉 First time installation!");
        // ניתן להוסיף כאן פתיחת דף Welcome או הוראות
    } else if (details.reason === 'update') {
        console.log("🔄 Extension updated to version 2.0!");
    }
});

// האזנה להודעות מ-content script (אם נרצה בעתיד)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("📨 Message received:", request);
    
    if (request.action === 'getSettings') {
        chrome.storage.sync.get(null, (settings) => {
            sendResponse({ settings });
        });
        return true; // נדרש עבור async response
    }
    
    if (request.action === 'log') {
        console.log("📝 Log from content script:", request.message);
    }
});

// מעקב אחרי לחיצה על האייקון (אם נרצה לבצע פעולות)
chrome.action.onClicked.addListener((tab) => {
    console.log("🖱️ Extension icon clicked on tab:", tab.id);
    // הפופאפ ייפתח אוטומטית, אבל ניתן להוסיף כאן לוגיקה נוספת
});

console.log("✅ Service Worker is fully operational!");