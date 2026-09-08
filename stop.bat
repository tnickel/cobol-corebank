@echo off
title COBOL CoreBank - Shutdown

echo =======================================================
echo   COBOL CoreBank - Backend beenden
echo =======================================================
echo.

setlocal enabledelayedexpansion
set "PID="

:: PID auf Port 3000 ermitteln
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr ":0 "') do (
    set "PID=%%a"
)

if defined PID (
    echo [INFO] Beende Prozess mit PID !PID!...
    taskkill /F /PID !PID! >nul 2>&1
    echo [ERFOLG] COBOL CoreBank Backend wurde erfolgreich beendet.
) else (
    echo [INFO] Kein laufender Server auf Port 3000 gefunden.
)

echo [INFO] PostgreSQL-Container laeuft weiter.
echo        Stoppen mit: docker compose down
echo.
timeout /t 2 /nobreak >nul 2>&1
exit /b 0
