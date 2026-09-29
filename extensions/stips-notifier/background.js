// קובץ: background.js (V12.0 - Multi-Strategy Fetch)
// אסטרטגיה: 1) fetch מתוך טאב סטיפס (same-origin) 2) DOM fallback 3) SW fetch

console.log("🔧 Stips Notifie Service Worker v12.0 started! (Multi-Strategy Fetch)");

const DEFAULT_SETTINGS = {
    enablePushNotifications: true,
    enableChatMessages: true,
    enableSystemMessages: true,
    disableNotificationsWhenActive: true,
    enableBackgroundCheck: false, // ✅ ברירת מחדל: כבוי (פרטיות)
    checkInterval: 10000  // 10 שניות - בטוח כי in-tab fetch הוא same-origin
};

let SETTINGS = { ...DEFAULT_SETTINGS };
let isProcessing = false;
let lastProcessTime = 0;

// ✅ Rate Limit Backoff
let rateLimitConsecutive = 0;
let rateLimitUntil = 0;
let usedomFallback = false;  // מסמן שצריך לעבור ל-DOM כי ה-API חסום

// ✅ מונה יציבות - נאפס רק אחרי 2 בדיקות רצופות של 0
let consecutiveZeroCount = 0;
const STABILITY_THRESHOLD = 2;

// ✅ מונה יציבות להתראות חיוביות
let consecutivePositiveCount = 0;
const POSITIVE_STABILITY_THRESHOLD = 2;

// Cooldown אחרי רענון עמוד
let lastTabLoadTime = {};
const PAGE_LOAD_COOLDOWN = 500;

// ✅ מנגנון מניעת הבהוב (Resurfacing Suppression)
let suppressionState = { chat: 0, alert: 0, time: 0 };
const SUPPRESSION_WINDOW = 10000;

// מזהים קבועים
const NOTIF_ID_CHAT = 'stips-chat-notification';
const NOTIF_ID_ALERT = 'stips-alert-notification';
const NOTIF_ID_COMBINED = 'stips-combined-notification';

// API URL
const STIPS_API_URL = 'https://stips.co.il/api?name=messages.count&api_params=%7B%7D';

// -----------------------------------------------------------------
// ✅ פונקציה: ניקוי ספירות והתראות
// -----------------------------------------------------------------
async function clearAllCountsAndNotifications() {
    await setStorageData({ lastChatCount: 0, lastAlertCount: 0 });
    chrome.notifications.clear(NOTIF_ID_COMBINED);
    chrome.notifications.clear(NOTIF_ID_CHAT);
    chrome.notifications.clear(NOTIF_ID_ALERT);
    console.log("🗑️ Global clear: Counts set to 0 and notifications removed.");
}

// -----------------------------------------------------------------
// פונקציות עזר ל-Storage
// -----------------------------------------------------------------
function getStorageData(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (res) => {
            if (chrome.runtime.lastError) {
                console.warn("⚠️ getStorageData error:", chrome.runtime.lastError);
                resolve({}); // Fallback to avoid TypeError
            } else {
                resolve(res || {});
            }
        });
    });
}

function setStorageData(data) {
    return new Promise((resolve) => {
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                console.warn("⚠️ setStorageData error:", chrome.runtime.lastError);
            }
            resolve();
        });
    });
}

async function loadSettings() {
    try {
        SETTINGS = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    } catch (error) {
        SETTINGS = DEFAULT_SETTINGS;
    }
}

// -----------------------------------------------------------------
// ⏰ מנגנון בדיקה + Keep-Alive
// -----------------------------------------------------------------
const KEEP_ALIVE_ALARM = 'keepAliveAlarm';
const CHECK_ALARM = 'checkStipsAlarm';

async function createOrUpdateAlarm() {
    await loadSettings();
    const intervalInMinutes = Math.max(0.166, SETTINGS.checkInterval / 60000); // מינימום 10 שניות

    await chrome.alarms.clearAll();

    chrome.alarms.create(CHECK_ALARM, {
        periodInMinutes: intervalInMinutes,
        delayInMinutes: 0.1
    });

    chrome.alarms.create(KEEP_ALIVE_ALARM, {
        periodInMinutes: 0.4
    });

    console.log(`⏰ Alarms set: Check every ${Math.round(intervalInMinutes * 60)}s, Keep-alive every 24s`);
}

function keepAlive() {
    console.log(`💓 Keep-alive ping at ${new Date().toLocaleTimeString()}`);
}

chrome.runtime.onInstalled.addListener(async () => {
    await createOrUpdateAlarm();
    console.log("📦 Extension installed/reloaded. Ready.");
    checkStipsNow();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log("🚀 Browser started. Initializing alarms...");
    await createOrUpdateAlarm();
    checkStipsNow();
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.checkInterval || changes.enablePushNotifications) {
        createOrUpdateAlarm();
    }
    loadSettings();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
        if (alarm.name === KEEP_ALIVE_ALARM) {
            keepAlive();
        } else if (alarm.name === CHECK_ALARM) {
            if (!SETTINGS) await loadSettings();
            if (SETTINGS.enablePushNotifications) {
                await checkStipsNow();
            }
        }
    } catch (error) {
        console.error("❌ Alarm handler error:", error);
        createOrUpdateAlarm();
    }
});

setInterval(async () => {
    try {
        const alarms = await chrome.alarms.getAll();
        if (alarms.length < 2) {
            console.warn("⚠️ Alarms missing! Recreating...");
            await createOrUpdateAlarm();
        }
    } catch (e) { }
}, 30000);

// =================================================================
// 🌟 Multi-Strategy Fetch Engine
// =================================================================

/**
 * אסטרטגיה 1: fetch מתוך טאב סטיפס פתוח (same-origin!)
 * הפקודה רצה בקונטקסט של הדף עצמו → Origin = https://stips.co.il → אין rate limit
 */
async function fetchViaTab(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async () => {
            try {
                const resp = await fetch('https://stips.co.il/api?name=messages.count&api_params=%7B%7D', {
                    method: 'GET',
                    credentials: 'include'
                });
                if (!resp.ok) return { error: 'http_' + resp.status };
                const json = await resp.json();
                return json;
            } catch (e) {
                return { error: e.message };
            }
        },
        world: 'MAIN'  // חשוב! רץ בקונטקסט של הדף, לא של התוסף
    });

    if (results && results[0] && results[0].result) {
        return results[0].result;
    }
    return { error: 'no_result' };
}

/**
 * אסטרטגיה 2: קריאת DOM badges ישירות מטאב פתוח
 * לא שולח שום בקשת רשת — פשוט קורא את האלמנטים מהדף
 */
async function fetchViaDom(tabId) {
    const results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
            const CHAT_SELECTOR = ".chat .count-badge, .chat-badge, [class*='chat-badge'], .messages-badge";
            const ALERT_SELECTOR = ".notification .count-badge, .alerts-badge, [class*='alerts-badge']";
            const extract = (el) => {
                if (!el) return 0;
                const txt = el.textContent.trim();
                if (txt === '•' || txt === '') return 1;
                return parseInt(txt, 10) || 0;
            };
            return {
                chatCount: extract(document.querySelector(CHAT_SELECTOR)),
                alertCount: extract(document.querySelector(ALERT_SELECTOR))
            };
        }
    });

    if (results && results[0] && results[0].result) {
        return results[0].result;
    }
    return null;
}

/**
 * אסטרטגיה 3: fetch מה-Service Worker (cross-origin, עם headers משופרים מ-declarativeNetRequest)
 */
async function fetchViaServiceWorker() {
    // 🔙 חזרנו לשיטה הישנה שעבדה: דימוי מושלם של בקשת דפדפן
    try {
        const response = await fetch(STIPS_API_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
                // הערה: Referer ו- X-Requested-With מתווספים על ידי rules.json (declarativeNetRequest)
            },
            credentials: 'include',
            // דימוי מושלם של בקשת דפדפן מאובטחת
            mode: 'cors',
            cache: 'no-cache',
            redirect: 'follow',
            referrerPolicy: 'strict-origin-when-cross-origin'
        });

        if (!response.ok) {
            return { error: 'http_' + response.status };
        }

        return await response.json();
    } catch (e) {
        return { error: e.message };
    }
}

/**
 * פונקציית התזמור הראשית — מנהלת את 3 האסטרטגיות
 */
async function checkStipsNow() {
    try {
        // ✅ Rate Limit Backoff: אם אנחנו בהמתנה, לא שולחים בקשה
        if (Date.now() < rateLimitUntil) {
            const waitSec = Math.round((rateLimitUntil - Date.now()) / 1000);
            console.log(`⏳ Rate limit backoff: waiting ${waitSec}s before next API call`);
            // אבל אם יש טאב פתוח — ננסה DOM fallback!
            const tabs = await chrome.tabs.query({ url: "*://*.stips.co.il/*" });
            if (tabs.length > 0 && tabs[0].status === 'complete') {
                console.log("📡 Strategy: DOM_FALLBACK (rate limited, but tab available)");
                await setStorageData({ currentStrategy: 'DOM_FALLBACK' });
                const domResult = await fetchViaDom(tabs[0].id);
                if (domResult) {
                    const isActive = await isTabActive(tabs[0]);
                    await processNewCounts(domResult.chatCount, domResult.alertCount, isActive);
                    return;
                }
            }
            return;
        }

        // ✅ בדיקה אם יש טאב סטיפס פתוח
        let isAnyActive = false;
        let stipsTab = null;

        try {
            const allStipsTabs = await chrome.tabs.query({ url: "*://*.stips.co.il/*" });
            if (allStipsTabs.length > 0) {
                // מעדיפים טאב שטעינתו הושלמה
                stipsTab = allStipsTabs.find(t => t.status === 'complete') || allStipsTabs[0];
            }
            isAnyActive = await checkIfTabIsActive();
        } catch (e) { }

        // ═════════════════════════════════════════════════════════
        // 🏆 אסטרטגיה 1: In-Tab Fetch (same-origin, העדיפות הכי גבוהה)
        // ═════════════════════════════════════════════════════════
        if (stipsTab && stipsTab.status === 'complete' && !usedomFallback) {
            try {
                console.log(`📡 Strategy: IN_TAB_FETCH (tab ${stipsTab.id})`);
                await setStorageData({ currentStrategy: 'IN_TAB_FETCH' });

                const json = await fetchViaTab(stipsTab.id);

                if (json.error) {
                    console.warn(`⚠️ In-tab fetch error: ${json.error}`);
                    // fallback ל-DOM
                    console.log("📡 Falling back to DOM_FALLBACK");
                    await setStorageData({ currentStrategy: 'DOM_FALLBACK' });
                    const domResult = await fetchViaDom(stipsTab.id);
                    if (domResult) {
                        await setStorageData({ isLoggedIn: true });
                        await processNewCounts(domResult.chatCount, domResult.alertCount, isAnyActive);
                    }
                    return;
                }

                // בדיקת rate limit (גם מתוך הטאב — לא אמור לקרות, אבל ליתר ביטחון)
                if (json.status !== 'ok') {
                    if (json.error_code === 'IP_RATE_LIMIT') {
                        console.warn("🚫 Rate limited even from tab! Switching to DOM fallback");
                        usedomFallback = true;
                        // ננסה DOM מיד
                        const domResult = await fetchViaDom(stipsTab.id);
                        if (domResult) {
                            await setStorageData({ isLoggedIn: true, currentStrategy: 'DOM_FALLBACK' });
                            await processNewCounts(domResult.chatCount, domResult.alertCount, isAnyActive);
                        }
                        // איפוס הדגל אחרי 2 דקות
                        setTimeout(() => { usedomFallback = false; }, 120000);
                        return;
                    }
                    console.warn('⚠️ API returned non-ok:', json);
                    await setStorageData({ isLoggedIn: false });
                    return;
                }

                // ✅ הצלחה! איפוס backoff
                if (rateLimitConsecutive > 0) {
                    console.log(`✅ Rate limit cleared after ${rateLimitConsecutive} retries`);
                    rateLimitConsecutive = 0;
                    rateLimitUntil = 0;
                    usedomFallback = false;
                }

                const chatCount = json.data.messagesCount || 0;
                const alertCount = json.data.notificationsCount || 0;
                await setStorageData({ isLoggedIn: true });

                console.log(`🌐 [IN_TAB] Chat=${chatCount}, Alert=${alertCount}, Active=${isAnyActive}`);
                await processNewCounts(chatCount, alertCount, isAnyActive);
                return;

            } catch (err) {
                console.warn(`⚠️ In-tab strategy failed: ${err.message}. Trying next...`);
            }
        }

        // ═════════════════════════════════════════════════════════
        // 🔄 אסטרטגיה 2: DOM Fallback (טאב פתוח + rate limited)
        // ═════════════════════════════════════════════════════════
        if (stipsTab && stipsTab.status === 'complete' && usedomFallback) {
            try {
                console.log(`📡 Strategy: DOM_FALLBACK (tab ${stipsTab.id})`);
                await setStorageData({ currentStrategy: 'DOM_FALLBACK' });

                const domResult = await fetchViaDom(stipsTab.id);
                if (domResult) {
                    await setStorageData({ isLoggedIn: true });
                    console.log(`🌐 [DOM] Chat=${domResult.chatCount}, Alert=${domResult.alertCount}, Active=${isAnyActive}`);
                    await processNewCounts(domResult.chatCount, domResult.alertCount, isAnyActive);
                    return;
                }
            } catch (err) {
                console.warn(`⚠️ DOM fallback failed: ${err.message}`);
            }
        }

        // ═════════════════════════════════════════════════════════
        // 🌐 אסטרטגיה 3: Service Worker Fetch (אין טאב פתוח)
        // ═════════════════════════════════════════════════════════
        try {
            console.log("📡 Strategy: SERVICE_WORKER_FETCH");

            // ✅ בדיקת הגדרת פרטיות: אם המשתמש לא אישר בדיקת רקע, עוצרים כאן.
            if (!SETTINGS.enableBackgroundCheck) {
                console.log("🚫 Background check disabled by user (Privacy Mode). Skipping fetch.");
                return;
            }

            await setStorageData({ currentStrategy: 'SERVICE_WORKER_FETCH' });

            const json = await fetchViaServiceWorker();

            if (json.error) {
                console.warn(`⚠️ SW fetch error: ${json.error}`);
                await setStorageData({ isLoggedIn: false });
                return;
            }

            // ✅ טיפול ב-Rate Limit וכל שגיאת API אחרת
            if (json.status !== 'ok') {
                if (json.error_code === 'IP_RATE_LIMIT') {
                    rateLimitConsecutive++;
                    const backoffMs = Math.min(15000 * Math.pow(2, rateLimitConsecutive - 1), 300000);
                    rateLimitUntil = Date.now() + backoffMs;
                    console.warn(`🚫 Rate limited! Backing off for ${backoffMs / 1000}s (attempt ${rateLimitConsecutive})`);
                } else {
                    console.warn('⚠️ API returned non-ok status or 500:', json);
                }

                // לפני שמוותרים - אם יש טאב סטיפס פתוח, ננסה להציל את המצב דרך ה-DOM!
                if (stipsTab && stipsTab.status === 'complete') {
                    console.warn(`🚑 API failed (SW). Trying to rescue via DOM_FALLBACK on tab ${stipsTab.id}`);
                    usedomFallback = true;
                    await setStorageData({ currentStrategy: 'DOM_FALLBACK' });
                    const domResult = await fetchViaDom(stipsTab.id);
                    if (domResult) {
                        await setStorageData({ isLoggedIn: true });
                        console.log(`🌐 [DOM-Rescue] Chat=${domResult.chatCount}, Alert=${domResult.alertCount}, Active=${isAnyActive}`);
                        await processNewCounts(domResult.chatCount, domResult.alertCount, isAnyActive);
                        return;
                    }
                }

                await setStorageData({ isLoggedIn: false });
                return;
            }

            // ✅ הצלחה! איפוס backoff
            if (rateLimitConsecutive > 0) {
                console.log(`✅ Rate limit cleared after ${rateLimitConsecutive} retries`);
                rateLimitConsecutive = 0;
                rateLimitUntil = 0;
            }

            const chatCount = json.data.messagesCount || 0;
            const alertCount = json.data.notificationsCount || 0;
            await setStorageData({ isLoggedIn: true });

            console.log(`🌐 [SW] Chat=${chatCount}, Alert=${alertCount}, Active=${isAnyActive}`);
            await processNewCounts(chatCount, alertCount, isAnyActive);

        } catch (err) {
            console.warn('⚠️ SW fetch failed entirely:', err.message);
            // הצלה אחרונה דרך DOM אם יש טאב פתוח
            if (stipsTab && stipsTab.status === 'complete') {
                console.warn(`🚑 SW Network failed. Rescuing via DOM_FALLBACK on tab ${stipsTab.id}`);
                usedomFallback = true;
                await setStorageData({ currentStrategy: 'DOM_FALLBACK' });
                const domResult = await fetchViaDom(stipsTab.id);
                if (domResult) {
                     await setStorageData({ isLoggedIn: true });
                     await processNewCounts(domResult.chatCount, domResult.alertCount, isAnyActive);
                     return;
                }
            }
            await setStorageData({ isLoggedIn: false });
        }

    } catch (err) {
        console.error("❌ checkStipsNow fatal error:", err);
    }
}

/**
 * בדיקה אם הטאב הפעיל הוא טאב סטיפס בחלון הפוקוס
 */
async function checkIfTabIsActive() {
    try {
        const activeTabs = await chrome.tabs.query({
            url: "*://*.stips.co.il/*",
            active: true,
            lastFocusedWindow: true
        });
        return activeTabs.length > 0;
    } catch (e) {
        return false;
    }
}

/**
 * בדיקה אם טאב ספציפי הוא אקטיבי בחלון הפוקוס
 */
async function isTabActive(tab) {
    try {
        if (!tab.active) return false;
        const win = await chrome.windows.get(tab.windowId);
        return win.focused;
    } catch (e) {
        return false;
    }
}

// ✅ מאזין לטעינת עמודים - מעדכן cooldown ומאפס מונים
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url && tab.url.includes('stips.co.il')) {
        lastTabLoadTime[tabId] = Date.now();
        console.log(`🔄 Tab ${tabId} is loading. Setting cooldown.`);
        consecutiveZeroCount = 0;
        consecutivePositiveCount = 0;
    }
    // ✅ כשטאב סטיפס נטען → כבה את DOM fallback (כי עכשיו יש טאב חדש שאפשר לעשות בו fetch)
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('stips.co.il')) {
        if (usedomFallback) {
            console.log("🔄 Stips tab loaded - resetting DOM fallback flag, will try in-tab fetch next");
            usedomFallback = false;
        }
    }
});

// =================================================================
// ⚙️ לוגיקת עיבוד פושים (processNewCounts — ללא שינוי מ-V11)
// =================================================================
async function processNewCounts(chatCount, alertCount, isTabActive, tabId = null) {
    // ✅ בדיקת cooldown נוספת
    if (tabId && lastTabLoadTime[tabId] && (Date.now() - lastTabLoadTime[tabId] < PAGE_LOAD_COOLDOWN)) {
        return;
    }
    const now = Date.now();

    if (isProcessing && (now - lastProcessTime > 10000)) {
        console.warn("⚠️ Stuck lock detected. Releasing force...");
        isProcessing = false;
    }

    if (isProcessing) return;

    isProcessing = true;
    lastProcessTime = now;

    try {
        if (!SETTINGS) await loadSettings();

        const stored = await getStorageData(['lastChatCount', 'lastAlertCount']);

        // 1. טיפול בהתקנה ראשונית - סנכרון שקט
        if (stored.lastChatCount === undefined || stored.lastAlertCount === undefined) {
            console.log(`ℹ️ Initial sync: Chat=${chatCount}, Alert=${alertCount}. No notification.`);
            await setStorageData({ lastChatCount: chatCount, lastAlertCount: alertCount });
            return;
        }

        const lastChat = stored.lastChatCount;
        const lastAlert = stored.lastAlertCount;

        // ✅ חישוב חכם עם מניעת הבהובים
        let effectiveLastChat = lastChat;
        let effectiveLastAlert = lastAlert;

        if (Date.now() - suppressionState.time < SUPPRESSION_WINDOW) {
            if (chatCount >= suppressionState.chat) {
                effectiveLastChat = Math.max(lastChat, suppressionState.chat);
                console.log(`🛡️ Suppression active for CHAT: Using effective ${effectiveLastChat} instead of ${lastChat}`);
            }
            if (alertCount >= suppressionState.alert) {
                effectiveLastAlert = Math.max(lastAlert, suppressionState.alert);
                console.log(`🛡️ Suppression active for ALERT: Using effective ${effectiveLastAlert} instead of ${lastAlert}`);
            }
        }

        // חישוב ההפרש
        const realNewChats = SETTINGS.enableChatMessages ? Math.max(0, chatCount - effectiveLastChat) : 0;
        const realNewAlerts = SETTINGS.enableSystemMessages ? Math.max(0, alertCount - effectiveLastAlert) : 0;

        // לוג דיבוג ברור
        console.log(`🔍 Check: Current Chat=${chatCount} (Last=${lastChat}), Current Alert=${alertCount} (Last=${lastAlert}) | ActiveTab? ${isTabActive}`);

        const shouldNotify = (realNewChats > 0 || realNewAlerts > 0);
        const lastWasPositive = lastChat > 0 || lastAlert > 0;

        // ✅ 1. לוגיקה לטיפול באיפוס (המשתמש קרא הכל)
        if (chatCount === 0 && alertCount === 0) {
            consecutiveZeroCount++;
            if (consecutiveZeroCount <= STABILITY_THRESHOLD + 1) {
                console.log(`🔍 Zero count detected. Consecutive: ${consecutiveZeroCount}/${STABILITY_THRESHOLD}`);
            }

            if (consecutiveZeroCount >= STABILITY_THRESHOLD && lastWasPositive) {
                console.log("🗑️ Stable zero detected! Resetting LastCount to 0.");

                suppressionState = {
                    chat: stored.lastChatCount,
                    alert: stored.lastAlertCount,
                    time: Date.now()
                };
                console.log(`💾 State saved for suppression: C=${suppressionState.chat}, A=${suppressionState.alert}`);

                chrome.notifications.clear(NOTIF_ID_COMBINED);
                chrome.notifications.clear(NOTIF_ID_CHAT);
                chrome.notifications.clear(NOTIF_ID_ALERT);
                await setStorageData({ lastChatCount: 0, lastAlertCount: 0 });
            }
            return;
        }

        // איפוס מונה היציבות אם יש ספירה חיובית
        consecutiveZeroCount = 0;

        // ✅ 2. טיפול בהשתקה (Active Tab)
        if (isTabActive && SETTINGS.disableNotificationsWhenActive) {
            console.log(`🔕 Active tab - muting (NOT syncing). Chat=${chatCount}, Alert=${alertCount}`);
            chrome.notifications.clear(NOTIF_ID_COMBINED);
            chrome.notifications.clear(NOTIF_ID_CHAT);
            chrome.notifications.clear(NOTIF_ID_ALERT);
            return;
        }

        // 3. יצירת ההתראה
        if (!shouldNotify) {
            return;
        }

        let notificationId = null;
        let title = '';
        let message = '';
        let buttons = [];

        console.log(`📊 Notification decision: realNewChats=${realNewChats}, realNewAlerts=${realNewAlerts}`);

        if (realNewChats > 0 && realNewAlerts > 0) {
            notificationId = NOTIF_ID_COMBINED;
            title = "🔔 חדש בסטיפס!";
            message = `${realNewChats} צ'אטים ו-${realNewAlerts} התראות חדשות`;
            buttons = [{ title: "💬 לצ'אט" }, { title: "🔔 להתראות" }];
            console.log(`✅ Combined notification triggered: ${realNewChats} chats + ${realNewAlerts} alerts`);
        }
        else if (realNewChats > 0) {
            notificationId = NOTIF_ID_CHAT;
            title = "💬 הודעה חדשה";
            message = realNewChats === 1 ? "יש לך הודעת צ'אט חדשה" : `יש לך ${realNewChats} הודעות צ'אט חדשות`;
        }
        else if (realNewAlerts > 0) {
            notificationId = NOTIF_ID_ALERT;
            title = "🔔 התראת מערכת";
            message = realNewAlerts === 1 ? "יש לך התראה חדשה" : `יש לך ${realNewAlerts} התראות חדשות`;
        }

        if (notificationId) {
            chrome.notifications.clear(NOTIF_ID_COMBINED);
            chrome.notifications.clear(NOTIF_ID_CHAT);
            chrome.notifications.clear(NOTIF_ID_ALERT);

            chrome.notifications.create(notificationId, {
                type: "basic",
                iconUrl: "icon48.png",
                title: title,
                message: message,
                priority: 2,
                buttons: buttons,
                requireInteraction: false
            });
            console.log(`✅ Notification dispatched: ${title}. New Last Count: Chat=${chatCount}, Alert=${alertCount}`);
        }

        await setStorageData({ lastChatCount: chatCount, lastAlertCount: alertCount });

    } catch (err) {
        console.error("❌ Error in processNewCounts:", err);
    } finally {
        // ✅ עדכון הבאדג' (Badge)
        const totalCount = chatCount + alertCount;
        if (totalCount > 0) {
            chrome.action.setBadgeText({ text: totalCount.toString() });
            chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
        } else {
            chrome.action.setBadgeText({ text: "" });
        }

        // ✅ עדכון ה-Tray App
        sendToTrayApp(chatCount, alertCount);

        isProcessing = false;
    }
}

// -----------------------------------------------------------------
// 🚀 תקשורת עם אפליקציית ה-Tray (Localhost)
// -----------------------------------------------------------------
async function sendToTrayApp(chat, alert) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 200);

        await fetch(`http://127.0.0.1:8085/update?chat=${chat}&alert=${alert}`, {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
    } catch (e) {
        // התעלמות
    }
}

// -----------------------------------------------------------------
// תקשורת, קליקים
// -----------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'notifyCounts') {
        // ✅ DOM-based content-script messages - עדיין מושהה
        console.log('📭 DOM-based notifyCounts received (using multi-strategy method)');
    }
});

async function openStipsTab(targetUrl) {
    const tabs = await chrome.tabs.query({ url: "*://*.stips.co.il/*" });
    if (tabs.length > 0) {
        await chrome.tabs.update(tabs[0].id, { active: true, url: targetUrl });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
        await chrome.tabs.create({ url: targetUrl });
    }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
    let url = "https://stips.co.il/";
    if (notificationId === NOTIF_ID_CHAT) url = "https://stips.co.il/messages";
    if (notificationId === NOTIF_ID_ALERT) url = "https://stips.co.il/notifications";
    if (notificationId === NOTIF_ID_COMBINED) url = "https://stips.co.il/notifications";

    await openStipsTab(url);
    chrome.notifications.clear(notificationId);
    await clearAllCountsAndNotifications();
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    console.log(`🖱️ Button clicked: notificationId=${notificationId}, buttonIndex=${buttonIndex}`);

    if (notificationId === NOTIF_ID_COMBINED) {
        if (buttonIndex === 0) {
            console.log("➡️ Opening chat messages...");
            await openStipsTab("https://stips.co.il/messages");
        } else if (buttonIndex === 1) {
            console.log("➡️ Opening notifications...");
            await openStipsTab("https://stips.co.il/notifications");
        }
    } else if (notificationId === NOTIF_ID_CHAT) {
        console.log("➡️ Opening chat messages...");
        await openStipsTab("https://stips.co.il/messages");
    } else if (notificationId === NOTIF_ID_ALERT) {
        console.log("➡️ Opening notifications...");
        await openStipsTab("https://stips.co.il/notifications");
    }

    chrome.notifications.clear(notificationId);
    await clearAllCountsAndNotifications();
});