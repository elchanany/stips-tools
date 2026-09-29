// Stips Enhancer - Content Script v7.0 (Fixed Debounce & Loop)
// ⚠️ SUSPENDED: DOM-based checking is suspended in favor of API-based checking in background.js v11.0
// All code below is preserved but initialization is disabled.

console.log("⏸️ Stips Enhancer Content Script v7.0 loaded (SUSPENDED - using API method)");

// ==================== הגדרות ראשוניות ====================
const DEFAULT_SETTINGS = {
    enablePushNotifications: true,
    enableChatMessages: true,
    enableSystemMessages: true
};

let SETTINGS = { ...DEFAULT_SETTINGS };
let observer = null;
let isInitialized = false;
let debounceTimer = null; // משתנה לשמירת הטיימר

// ==================== לוגיקת ספירת התראות ====================

function getCounts() {
    // סלקטורים מעודכנים
    const CHAT_SELECTOR = ".chat .count-badge, .chat-badge, [class*='chat-badge'], .messages-badge";
    const ALERT_SELECTOR = ".notification .count-badge, .alerts-badge, [class*='alerts-badge']";

    const chatBadge = document.querySelector(CHAT_SELECTOR);
    const alertBadge = document.querySelector(ALERT_SELECTOR);

    const extractCount = (element) => {
        if (!element) return 0;
        const text = element.textContent.trim();
        if (text === '•' || text === '') return 1;
        const count = parseInt(text, 10);
        return isNaN(count) ? 0 : count;
    };

    return {
        chatCount: extractCount(chatBadge),
        alertCount: extractCount(alertBadge)
    };
}

function checkCountsAndNotify() {
    if (!SETTINGS.enablePushNotifications) return;

    const { chatCount, alertCount } = getCounts();

    // שליחת נתונים רק אם יש חיבור תקין
    if (chrome.runtime && chrome.runtime.id) {
        try {
            chrome.runtime.sendMessage({
                action: 'notifyCounts',
                chatCount: chatCount,
                alertCount: alertCount
            });
        } catch (error) {
            // התעלמות משגיאות ניתוק רגילות
        }
    }
}

// ==================== לוגיקת אובזרבר (מתוקנת) ====================

const TARGET_SELECTOR = 'body';

function handleMutations(mutationsList) {
    // ✅ תיקון קריטי: איפוס הטיימר הקודם כדי למנוע כפילויות
    if (debounceTimer) clearTimeout(debounceTimer);

    // המתנה של שנייה שלמה כדי לוודא שהאתר סיים לטעון את כל האלמנטים
    debounceTimer = setTimeout(() => {
        checkCountsAndNotify();
    }, 1000);
}

function initObserver() {
    const targetNode = document.querySelector(TARGET_SELECTOR);

    if (observer) observer.disconnect();

    if (targetNode) {
        const config = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'data-count'] // סינון אגרסיבי יותר
        };

        observer = new MutationObserver(handleMutations);
        observer.observe(targetNode, config);

        console.log("✅ Observer active.");
        checkCountsAndNotify();
    }
}

// ==================== אתחול ====================
function initialize() {
    if (isInitialized) return;

    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
        SETTINGS = { ...DEFAULT_SETTINGS, ...settings };

        if (SETTINGS.enablePushNotifications) {
            initObserver();
        }
        isInitialized = true;
    });

    chrome.storage.onChanged.addListener((changes) => {
        chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
            SETTINGS = { ...DEFAULT_SETTINGS, ...settings };

            if (SETTINGS.enablePushNotifications) {
                if (!observer) initObserver();
            } else {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            }
        });
    });
}

// ⚠️ SUSPENDED - initialization disabled while using API-based checking
if (false) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
}