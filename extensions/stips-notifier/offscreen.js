// offscreen.js - סקריפט שרץ בדף הנסתר וקורא את ה-DOM של סטיפס

console.log("🔮 Offscreen document loaded!");

const CHAT_SELECTOR = ".chat .count-badge, .chat-badge, [class*='chat-badge'], .messages-badge";
const ALERT_SELECTOR = ".notification .count-badge, .alerts-badge, [class*='alerts-badge']";

let checkInterval = null;
let iframeLoaded = false;
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 5;

// פונקציה לחילוץ מספר מ-badge
function extractCount(element) {
    if (!element) return 0;
    const text = element.textContent.trim();
    if (text === '•' || text === '') return 1;
    const count = parseInt(text, 10);
    return isNaN(count) ? 0 : count;
}

// פונקציה לקריאת ספירות מה-iframe
function getCountsFromIframe() {
    try {
        const iframe = document.getElementById('stipsFrame');
        if (!iframe || !iframe.contentDocument) {
            console.log("⚠️ Cannot access iframe content (might be blocked by X-Frame-Options)");
            return null;
        }

        const iframeDoc = iframe.contentDocument;
        const chatBadge = iframeDoc.querySelector(CHAT_SELECTOR);
        const alertBadge = iframeDoc.querySelector(ALERT_SELECTOR);

        return {
            chatCount: extractCount(chatBadge),
            alertCount: extractCount(alertBadge)
        };
    } catch (error) {
        console.error("❌ Error reading iframe:", error.message);
        return null;
    }
}

// פונקציה שבודקת ושולחת את הספירות ל-background
function checkAndReport() {
    const counts = getCountsFromIframe();

    if (counts) {
        console.log(`📊 Offscreen check: Chat=${counts.chatCount}, Alert=${counts.alertCount}`);

        // שליחה ל-background script
        chrome.runtime.sendMessage({
            action: 'offscreenCounts',
            chatCount: counts.chatCount,
            alertCount: counts.alertCount
        });
    }
}

// מאזין לטעינת ה-iframe
document.getElementById('stipsFrame').addEventListener('load', () => {
    console.log("✅ Stips iframe loaded!");
    iframeLoaded = true;
    loadAttempts = 0;

    // בדיקה ראשונית אחרי טעינה
    setTimeout(checkAndReport, 2000);
});

// מאזין לשגיאות ב-iframe
document.getElementById('stipsFrame').addEventListener('error', (e) => {
    console.error("❌ Iframe load error:", e);
    loadAttempts++;

    if (loadAttempts < MAX_LOAD_ATTEMPTS) {
        console.log(`🔄 Retrying iframe load (${loadAttempts}/${MAX_LOAD_ATTEMPTS})...`);
        setTimeout(() => {
            document.getElementById('stipsFrame').src = "https://stips.co.il/";
        }, 5000);
    }
});

// מאזין להודעות מה-background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkNow') {
        checkAndReport();
        sendResponse({ success: true });
    } else if (request.action === 'getStatus') {
        sendResponse({
            iframeLoaded: iframeLoaded,
            loadAttempts: loadAttempts
        });
    }
    return true;
});

// בדיקה תקופתית כל 5 שניות
checkInterval = setInterval(() => {
    if (iframeLoaded) {
        checkAndReport();
    }
}, 5000);

console.log("🔮 Offscreen script initialized. Waiting for iframe to load...");
