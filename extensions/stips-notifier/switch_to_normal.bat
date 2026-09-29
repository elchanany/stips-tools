@echo off
echo ========================================
echo   חזרה לגרסה הרגילה (עם טאב)
echo ========================================

copy /Y manifest_backup.json manifest.json
echo.
echo [OK] הועתק manifest_backup.json -> manifest.json
echo.
echo כעת רענן את התוסף ב-chrome://extensions
echo.
pause
