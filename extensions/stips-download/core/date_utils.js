/**
 * Stips Download - Date & Hebrew Calendar Utilities
 * Accurate datetime parsing, Gregorian formatting, and Hebrew Gematria conversion.
 */

// Gregorian Hebrew Month Names
const HEBREW_GREGORIAN_MONTHS = [
  'בינואר',
  'בפברואר',
  'במרץ',
  'באפריל',
  'במאי',
  'ביוני',
  'ביולי',
  'באוגוסט',
  'בספטמבר',
  'באוקטובר',
  'בנובמבר',
  'בדצמבר'
];

/**
 * Parses raw API time string (format: YYYY/MM/DD HH:mm:ss).
 * Strictly validates year between 2000 and 2100.
 * Returns null for missing/invalid input (NEVER Date(0)).
 */
function parseApiTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converts a positive number to Hebrew letters with proper Gershayim / Geresh.
 * e.g. 1 -> א', 15 -> ט"ו, 16 -> ט"ז, 23 -> כ"ג, 786 -> תשפ"ו
 */
function numberToHebrewLetters(num) {
  if (!num || typeof num !== 'number' || num <= 0) return '';

  const hundreds = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const units = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];

  let n = num % 1000;
  let str = '';

  // Hundreds
  const h = Math.floor(n / 100);
  if (h > 0) {
    if (h <= 4) {
      str += hundreds[h];
    } else if (h === 5) {
      str += 'תק';
    } else if (h === 6) {
      str += 'תר';
    } else if (h === 7) {
      str += 'תש';
    } else if (h === 8) {
      str += 'תת';
    } else if (h === 9) {
      str += 'תתק';
    }
  }

  // Remainder
  const rem = n % 100;
  if (rem === 15) {
    str += 'טו';
  } else if (rem === 16) {
    str += 'טז';
  } else {
    const t = Math.floor(rem / 10);
    const u = rem % 10;
    str += tens[t] + units[u];
  }

  if (str.length === 0) return '';
  if (str.length === 1) return str + '׳';

  // Add gershayim before last letter
  return str.slice(0, -1) + '״' + str.slice(-1);
}

/**
 * Formats Gregorian date in format: 17 במרץ (3) 2026
 */
function formatGregorianDate(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const day = date.getDate();
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  const monthName = HEBREW_GREGORIAN_MONTHS[month] || '';
  return `${day} ${monthName} (${month + 1}) ${year}`;
}

/**
 * Formats full Hebrew date in Hebrew letters.
 * e.g. י"ב באדר תשפ"ו
 */
function formatHebrewDate(date) {
  if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  try {
    // Extract parts using Intl with Hebrew calendar
    const formatter = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });

    const parts = formatter.formatToParts(date);
    let dayNum = 0;
    let monthName = '';
    let yearNum = 0;

    for (const p of parts) {
      if (p.type === 'day') dayNum = parseInt(p.value, 10);
      else if (p.type === 'month') monthName = p.value;
      else if (p.type === 'year') yearNum = parseInt(p.value, 10);
    }

    if (!dayNum || !yearNum || !monthName) {
      return '';
    }

    const dayHeb = numberToHebrewLetters(dayNum);
    const yearHeb = numberToHebrewLetters(yearNum % 1000);

    // Prefix 'ב' to month if not already present
    let prefix = 'ב';
    if (monthName.startsWith('ב')) {
      prefix = '';
    }

    return `${dayHeb} ${prefix}${monthName} ${yearHeb}`;
  } catch (err) {
    console.warn('Error formatting Hebrew date:', err);
    return '';
  }
}

/**
 * Normalizes message from raw API object using the verified reference logic.
 */
function normalizeApiMessage(raw, partnerId, partnerName, myProfileName = null) {
  if (!raw || !Number.isFinite(Number(raw.id))) {
    return null;
  }

  const date = parseApiTime(raw.time);
  if (!date) {
    return null;
  }

  const from = Number(raw.fromuserid);
  const side = from === Number(partnerId) ? 'other' : 'me';
  const meSender = myProfileName ? `${myProfileName} (אתה)` : 'אתה';
  const otherSender = partnerName || 'משתמש';

  const gregorianStr = formatGregorianDate(date);
  const hebrewDateStr = formatHebrewDate(date);
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  return {
    id: Number(raw.id),
    text: String(raw.msg ?? ''),
    fromuserid: Number(raw.fromuserid),
    touserid: Number(raw.touserid),
    side,
    sender: side === 'me' ? meSender : otherSender,
    timestamp: date.getTime(),
    rawTime: String(raw.time || ''),
    time: String(raw.time || '').slice(11, 16), // HH:mm
    hebrew_time: String(raw.hebrew_time || ''),
    gregorianDate: gregorianStr,
    hebrewDate: hebrewDateStr,
    dateKey
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseApiTime,
    numberToHebrewLetters,
    formatGregorianDate,
    formatHebrewDate,
    normalizeApiMessage,
    HEBREW_GREGORIAN_MONTHS
  };
}
