# Chrome Web Store Publishing Guide - Stips Extensions

This guide outlines the publishing procedures and assets for extensions in the **stips-tools** suite:

---

## 1. Stips Download
- **Source Directory**: `extensions/stips-download`
- **Production Package**: `stips_download_v1.0.0.zip` (ready for upload)
- **Manifest Version**: 3
- **Primary Category**: Social & Communication / Productivity
- **Language**: Hebrew (Primary)
- **Required Assets**:
  - `icons/icon128.png` (Store Icon)
  - `store_assets/screenshot_1280x800.png` (Screenshots)
  - `store_assets/marquee_440x280.png` (Small Promo Tile)
  - `webstore_description.txt` (Full description and permission justifications)
  - `PRIVACY_POLICY.md` (Privacy statement)

### Publishing Steps:
1. Log in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/developer/dashboard).
2. Click **Add new item** (or **New item**).
3. Upload `extensions/stips-download/stips_download_v1.0.0.zip`.
4. Fill in:
   - **Title**: Stips Download
   - **Summary**: `הורדת שיחות Stips לארכיון פרטי, מהיר ונוח לחיפוש עם תאריכים עבריים ולועזיים.`
   - **Description**: Copy contents from `extensions/stips-download/webstore_description.txt`.
   - **Category**: Social & Communication.
   - **Graphic Assets**: Upload store icon, screenshot, and marquee tile.
   - **Privacy Practices**: Copy Single Purpose & Permission justifications from `webstore_description.txt`.
5. Click **Submit for review**.

---

## 2. Stips Reveal
- **Source Directory**: `extensions/stips-reveal`
- **Version**: 1.4.1
- **Manifest Version**: 3
- **Description**: מציג גיל ומגדר של משתמשים באתר סטיפס

---

## 3. Stips Notifier
- **Source Directory**: `extensions/stips-notifier`
- **Version**: 12.1
- **Manifest Version**: 3
- **Description**: התראות פוש חכמות ועדכוני ספירה בזמן אמת לסטיפס
