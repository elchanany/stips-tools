// background_offscreen.js - גרסה חדשה עם Offscreen Document
// V11.0 - ניסוי Offscreen (ללא טאב פתוח)

console.log("🔧 Stips Notifie v11.0 - Offscreen Mode Started!");

const DEFAULT_SETTINGS = {
    enablePushNotifications: true,
    enableChatMessages: true,
    enableSystemMessages: true,
    disableNotificationsWhenActive: true,
    checkInterval: 5000
};

let SETTINGS = { ...DEFAULT_SETTINGS };
let offscreenCreated = false;

// מזהים קבועים
const NOTIF_ID_CHAT = 'stips-chat-notification';
const NOTIF_ID_ALERT = 'stips-alert-notification';
const NOTIF_ID_COMBINED = 'stips-combined-notification';

// -------------------------------------------------------------\\
// Storage helpers
// -------------------------------------------------------------\\
function getStorageData(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
    });
}

function setStorageData(data) {
    return new Promise((resolve) => {
        chrome.storage.local.set(data, resolve);
    });
}

async function loadSettings() {
    try {
        SETTINGS = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    } catch (error) {
        SETTINGS = DEFAULT_SETTINGS;
    }
}

// -------------------------------------------------------------\\
// Offscreen Document Management
// -------------------------------------------------------------\\
async function setupOffscreenDocument() {
    // בדיקה אם כבר קיים
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        console.log("✅ Offscreen document already exists");
        offscreenCreated = true;
        return;
    }

    // יצירת ה-offscreen document
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_SCRAPING'],
            justification: 'Reading notification counts from Stips website'
        });
        offscreenCreated = true;
        console.log("✅ Offscreen document created successfully!");
    } catch (error) {
        console.error("❌ Failed to create offscreen document:", error);
        offscreenCreated = false;
    }
}

// -------------------------------------------------------------\\
// Keep-Alive & Alarms
// -------------------------------------------------------------\\
const KEEP_ALIVE_ALARM = 'keepAliveAlarm';
const CHECK_ALARM = 'checkStipsAlarm';

async function createOrUpdateAlarm() {
    await loadSettings();
    const intervalInMinutes = Math.max(0.1, SETTINGS.checkInterval / 60000);

    await chrome.alarms.clearAll();

    chrome.alarms.create(CHECK_ALARM, {
        periodInMinutes: intervalInMinutes,
        delayInMinutes: 0.1
    });

    chrome.alarms.create(KEEP_ALIVE_ALARM, {
        periodInMinutes: 0.4
    });

    console.log(`⏰ Alarms set: Check every ${Math.round(intervalInMinutes * 60)}s`);
}

chrome.runtime.onInstalled.addListener(async () => {
    console.log("📦 Extension installed. Setting up offscreen...");
    await setupOffscreenDocument();
    await createOrUpdateAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log("🚀 Browser started. Setting up offscreen...");
    await setupOffscreenDocument();
    await createOrUpdateAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === KEEP_ALIVE_ALARM) {
        console.log(`💓 Keep-alive at ${new Date().toLocaleTimeString()}`);
        // וידוא ש-offscreen עדיין קיים
        if (!offscreenCreated) {
            await setupOffscreenDocument();
        }
    } else if (alarm.name === CHECK_ALARM) {
        if (SETTINGS.enablePushNotifications && offscreenCreated) {
            // בקשה מה-offscreen לבדוק
            try {
                chrome.runtime.sendMessage({ action: 'checkNow' });
            } catch (e) {
                console.log("⚠️ Offscreen not responding, recreating...");
                await setupOffscreenDocument();
            }
        }
    }
});

// -------------------------------------------------------------\\
// Message handling from offscreen
// -------------------------------------------------------------\\
let lastChatCount = 0;
let lastAlertCount = 0;

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'offscreenCounts') {
        const { chatCount, alertCount } = request;
        console.log(`📊 Received from offscreen: Chat=${chatCount}, Alert=${alertCount}`);

        await processNewCounts(chatCount, alertCount);
    }
});

async function processNewCounts(chatCount, alertCount) {
    await loadSettings();

    const stored = await getStorageData(['lastChatCount', 'lastAlertCount']);

    if (stored.lastChatCount === undefined) {
        console.log(`ℹ️ Initial sync: Chat=${chatCount}, Alert=${alertCount}`);
        await setStorageData({ lastChatCount: chatCount, lastAlertCount: alertCount });
        return;
    }

    const prevChat = stored.lastChatCount;
    const prevAlert = stored.lastAlertCount;

    const newChats = SETTINGS.enableChatMessages ? Math.max(0, chatCount - prevChat) : 0;
    const newAlerts = SETTINGS.enableSystemMessages ? Math.max(0, alertCount - prevAlert) : 0;

    console.log(`🔍 Check: Chat=${chatCount}(+${newChats}), Alert=${alertCount}(+${newAlerts})`);

    if (newChats === 0 && newAlerts === 0) {
        return;
    }

    // יצירת התראה
    let notificationId, title, message;
    let buttons = [];

    if (newChats > 0 && newAlerts > 0) {
        notificationId = NOTIF_ID_COMBINED;
        title = "🔔 חדש בסטיפס!";
        message = `${newChats} צ'אטים ו-${newAlerts} התראות חדשות`;
        buttons = [{ title: "💬 לצ'אט" }, { title: "🔔 להתראות" }];
    } else if (newChats > 0) {
        notificationId = NOTIF_ID_CHAT;
        title = "💬 הודעה חדשה";
        message = newChats === 1 ? "יש לך הודעת צ'אט חדשה" : `יש לך ${newChats} הודעות צ'אט`;
    } else {
        notificationId = NOTIF_ID_ALERT;
        title = "🔔 התראת מערכת";
        message = newAlerts === 1 ? "יש לך התראה חדשה" : `יש לך ${newAlerts} התראות`;
    }

    chrome.notifications.clear(NOTIF_ID_COMBINED);
    chrome.notifications.clear(NOTIF_ID_CHAT);
    chrome.notifications.clear(NOTIF_ID_ALERT);

    chrome.notifications.create(notificationId, {
        type: "basic",
        iconUrl: "icon48.png",
        title: title,
        message: message,
        priority: 2,
        buttons: buttons
    });

    console.log(`✅ Notification: ${title}`);
    await setStorageData({ lastChatCount: chatCount, lastAlertCount: alertCount });
}

// -------------------------------------------------------------\\
// Notification click handlers
// -------------------------------------------------------------\\
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
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    if (notificationId === NOTIF_ID_COMBINED) {
        if (buttonIndex === 0) await openStipsTab("https://stips.co.il/messages");
        if (buttonIndex === 1) await openStipsTab("https://stips.co.il/notifications");
    }
    chrome.notifications.clear(notificationId);
});

console.log("🔮 Offscreen mode background script ready!");
