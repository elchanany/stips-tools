@echo off
echo ========================================
echo   מעבר לגרסת Offscreen (ללא טאב)
echo ========================================

copy /Y manifest_offscreen.json manifest.json
echo.
echo [OK] הועתק manifest_offscreen.json -> manifest.json
echo.
echo כעת רענן את התוסף ב-chrome://extensions
echo.
pause
