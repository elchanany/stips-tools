// קובץ: options.js (v8.0 - API-based live status)

// הגדרות ברירת מחדל מעודכנות
const DEFAULT_SETTINGS = {
    enablePushNotifications: true, // ✅ ברירת מחדל: מופעל
    enableChatMessages: true,      // ✅ ברירת מחדל: מופעל
    enableSystemMessages: true,    // ✅ ברירת מחדל: מופעל
    disableNotificationsWhenActive: false, // ✅ ברירת מחדל: לא מוסמן
    enableBackgroundCheck: false   // ✅ ברירת מחדל: כבוי (פרטיות)
};

// --- Smart Interval Logics ---
// אפשרויות הקפיצה בסליידר (באלפיות השנייה):
// 10s, 15s, 20s, 30s, 45s, 60s, 1.5m, 2m, 3m, 4m, 5m, 7m, 8m, 10m
const INTERVAL_STEPS = [
    10000, 15000, 20000, 30000, 45000, 
    60000, 90000, 120000, 180000, 240000, 
    300000, 420000, 480000, 600000, 900000
];

function formatIntervalText(ms) {
    const totalSecs = ms / 1000;
    if (totalSecs < 60) {
        return `⏱️ כל ${totalSecs} שניות`;
    } else if (totalSecs % 60 === 0) {
        return `⏱️ כל ${totalSecs / 60} דקות`;
    } else {
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        return `⏱️ כל ${mins} דקות ו-${secs} שניות`;
    }
}

const CONTACT_EMAIL = 'EYCEYCEYC139@GMAIL.COM';
// הקישור המעודכן לפרופיל "אין משמעות"
const CREATOR_PROFILE_URL = 'https://stips.co.il/profile/429329';


// ------------------------------------------------------------------
// פונקציות לוגיות חדשות
// ------------------------------------------------------------------

/**
 * מפעילה או משביתה את כל המתגים התלויים במתג הראשי.
 * @param {boolean} isEnabled - האם המתג הראשי (enablePushNotifications) פעיל.
 */
function updateToggleStates(isEnabled) {
    const dependentToggles = [
        'enableChatMessages',
        'enableSystemMessages',
        'disableNotificationsWhenActive'
    ];

    dependentToggles.forEach(id => {
        const input = document.getElementById(id);
        const item = input ? input.closest('.setting-item') : null;

        if (item) {
            if (isEnabled) {
                // מפעיל מחדש
                item.classList.remove('disabled-item');
                input.disabled = false;
            } else {
                // משבית
                item.classList.add('disabled-item');
                input.disabled = true;
            }
        }
    });
}

// ------------------------------------------------------------------
// שמירת ההגדרות
// ------------------------------------------------------------------
function saveOptions() {
    // איסוף הערכים מהמתגים
    let checkInterval = '15000';
    const slider = document.getElementById('checkIntervalSlider');
    if (slider) {
        checkInterval = INTERVAL_STEPS[slider.value].toString();
    }

    chrome.storage.sync.set({
        enablePushNotifications: document.getElementById('enablePushNotifications').checked,
        enableChatMessages: document.getElementById('enableChatMessages').checked,
        enableSystemMessages: document.getElementById('enableSystemMessages').checked,
        disableNotificationsWhenActive: document.getElementById('disableNotificationsWhenActive').checked,
        enableBackgroundCheck: document.getElementById('enableBackgroundCheck').checked,
        checkInterval: checkInterval
    }, () => {
        const status = document.getElementById('status');
        if (status) {
            status.textContent = 'ההגדרות נשמרו ✓';
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 2000);
        }
    });
}

// ------------------------------------------------------------------
// טעינת ההגדרות
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// טעינת ההגדרות והסטטוס
// ------------------------------------------------------------------
function restoreOptions() {
    // טעינת הגדרות
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        document.getElementById('enablePushNotifications').checked = items.enablePushNotifications;
        document.getElementById('enableChatMessages').checked = items.enableChatMessages;
        document.getElementById('enableSystemMessages').checked = items.enableSystemMessages;
        document.getElementById('disableNotificationsWhenActive').checked = items.disableNotificationsWhenActive;
        document.getElementById('enableBackgroundCheck').checked = items.enableBackgroundCheck;

        const slider = document.getElementById('checkIntervalSlider');
        const display = document.getElementById('intervalDisplay');
        if (slider && display) {
            let val = parseInt(items.checkInterval || '15000', 10);
            
            // מוצא את האינדקס הכי קרוב במסלול
            let closestIndex = 0;
            let minDiff = Infinity;
            INTERVAL_STEPS.forEach((stepMs, index) => {
                let diff = Math.abs(stepMs - val);
                if (diff < minDiff) { 
                    minDiff = diff; 
                    closestIndex = index; 
                }
            });
            slider.max = INTERVAL_STEPS.length - 1;
            slider.value = closestIndex;
            display.textContent = formatIntervalText(INTERVAL_STEPS[closestIndex]);
        }

        updateToggleStates(items.enablePushNotifications);
    });

    // ✅ טעינת מונים מה-Storage + סטטוס חיבור
    chrome.storage.local.get(['lastChatCount', 'lastAlertCount', 'isLoggedIn'], (data) => {
        updateStatsDisplay(data.lastChatCount || 0, data.lastAlertCount || 0);
        updateAuthStatus(data.isLoggedIn);
    });

    // ✅ שליפת נתונים חיים מה-API כשפותחים את הפופאפ
    fetchLiveCounts();
}

const STIPS_API_URL = 'https://stips.co.il/api?name=messages.count&api_params=%7B%7D';

async function fetchLiveCounts() {
    try {
        const response = await fetch(STIPS_API_URL, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            updateAuthStatus(false);
            return;
        }

        const json = await response.json();

        if (json.status !== 'ok') {
            updateAuthStatus(false);
            return;
        }

        const chat = json.data.messagesCount || 0;
        const alert = json.data.notificationsCount || 0;
        updateStatsDisplay(chat, alert);
        updateAuthStatus(true);
    } catch (e) {
        updateAuthStatus(false);
    }
}

function updateAuthStatus(isLoggedIn) {
    const el = document.getElementById('authStatus');
    if (!el) return;
    el.classList.remove('auth-loading', 'auth-connected', 'auth-disconnected');
    if (isLoggedIn === true) {
        el.textContent = '✅ מחובר לסטיפס';
        el.classList.add('auth-connected');
    } else if (isLoggedIn === false) {
        el.textContent = '❌ לא מחובר - יש להתחבר לסטיפס';
        el.classList.add('auth-disconnected');
    } else {
        el.textContent = '⏳ בודק חיבור...';
        el.classList.add('auth-loading');
    }
}

function updateStatsDisplay(chat, alert) {
    const chatEl = document.getElementById('statChatCount');
    const alertEl = document.getElementById('statAlertCount');
    if (chatEl) chatEl.textContent = chat;
    if (alertEl) alertEl.textContent = alert;
}

// ✅ האזנה לשינויים בזמן אמת (כדי שהפופאפ יתעדכן אם הוא פתוח)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
        if (changes.lastChatCount || changes.lastAlertCount) {
            const newChat = changes.lastChatCount ? changes.lastChatCount.newValue : document.getElementById('statChatCount').textContent;
            const newAlert = changes.lastAlertCount ? changes.lastAlertCount.newValue : document.getElementById('statAlertCount').textContent;
            updateStatsDisplay(newChat, newAlert);
        }
        if (changes.isLoggedIn) {
            updateAuthStatus(changes.isLoggedIn.newValue);
        }
    }
});

// ------------------------------------------------------------------
// אירועי טעינה והאזנה
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();

    // הגדרת סליידר דינמי
    const slider = document.getElementById('checkIntervalSlider');
    const intervalDisplay = document.getElementById('intervalDisplay');
    if (slider && intervalDisplay) {
        slider.addEventListener('input', (e) => {
            const ms = INTERVAL_STEPS[e.target.value];
            intervalDisplay.textContent = formatIntervalText(ms);
        });
        // שומר רק כשעוזבים את הסליידר כדי לא להספים
        slider.addEventListener('change', () => {
             saveOptions();
        });
    }

    // שמירה אוטומטית בכל שינוי מתג
    const inputs = document.querySelectorAll('input[type="checkbox"]');
    inputs.forEach(input => {
        input.addEventListener('change', (e) => {
            // אם זה המתג רקע, נבדוק שהוא לא בוטל לפני שנשמור
            if (e.target.id === 'enableBackgroundCheck') {
                 // ההאזנה הייעודית שלו מתבצעת להלן, אך השמירה תקרה רק אם הצ'קבוקס באמת שונה למצב ההולם
                 // בטוח לשמור כאן בכל מקרה, כי האירוע מטופל במקביל
                 setTimeout(saveOptions, 50); // נותן למנגנון האישור (confirm) לרוץ קודם
            } else {
                 saveOptions();
            }
        });
    });

    // האזנה לשינוי במתג הראשי והפעלת לוגיקת ההשבתה
    const mainToggle = document.getElementById('enablePushNotifications');
    mainToggle.addEventListener('change', (event) => {
        updateToggleStates(event.target.checked);
    });

    // ✅ האזנה למתג רקע עם אזהרה
    const backgroundToggle = document.getElementById('enableBackgroundCheck');
    const warningAlert = document.getElementById('privacyWarning');
    
    // מתייחס למקרה של רסטור בהתחלה
    if (warningAlert && backgroundToggle && !backgroundToggle.checked) {
        warningAlert.classList.add('disabled');
    }

    if (backgroundToggle) {
        backgroundToggle.addEventListener('change', (event) => {
            if (event.target.checked) {
                // המשתמש מנסה להדליק - נציג אזהרה
                const confirmed = confirm("⚠️ אזהרה: מחובר תמיד!\n\nהפעלת אפשרות זו תבדוק הודעות גם כשאתה מחוץ לסטיפס (ברקע). מה שאומר שתופיע באתר כ-'מחובר' כל הזמן (כל עוד הדפדפן פתוח).\n\nהאם אתה בטוח שברצונך להמשיך?");
                if (!confirmed) {
                    event.target.checked = false; // מבטל את ההדלקה
                } else {
                    if (warningAlert) warningAlert.classList.remove('disabled');
                }
            } else {
                if (warningAlert) warningAlert.classList.add('disabled');
            }
        });
    }

    // -----------------------------------
    // לוגיקה של הפוטר (קישור ופופאפ)
    // -----------------------------------
    const creatorLink = document.getElementById('creatorLink');
    if (creatorLink) {
        creatorLink.addEventListener('click', () => {
            chrome.tabs.create({ url: CREATOR_PROFILE_URL });
        });
    }

    // הקוד למודל נשאר ללא שינוי (הוא כבר בוטל משימוש ב-HTML)
    // ...
});