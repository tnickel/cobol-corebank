@echo off
setlocal enabledelayedexpansion
title COBOL CoreBank Admin Interface

echo =======================================================
echo   COBOL CoreBank - Admin Interface
echo   GnuCOBOL 3.2 + GixSQL + PostgreSQL
echo =======================================================
echo.

cd /d "%~dp0"

REM 1. PostgreSQL via Docker Compose starten
echo [INFO] Starte PostgreSQL (Docker Compose)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start_postgres.ps1"
if errorlevel 1 (
    echo [FEHLER] PostgreSQL konnte nicht gestartet werden.
    echo          Bitte Docker Desktop starten und erneut versuchen.
    pause
    exit /b 1
)
echo.

REM 2. Pruefen, ob das COBOL-Binary existiert
if not exist "%~dp0bin\cobol_bank.exe" (
    echo [INFO] COBOL-Binary nicht gefunden. Starte Build...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build_cobol.ps1"
    if not exist "%~dp0bin\cobol_bank.exe" (
        echo [FEHLER] Kompilierung der COBOL-Engine fehlgeschlagen.
        pause
        exit /b 1
    )
    echo [ERFOLG] COBOL-Binary erfolgreich gebaut.
    echo.
)

REM 3. Pruefen, ob der Server auf Port 3000 bereits laeuft
netstat -ano | findstr ":3000 " | findstr ":0 " >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [STATUS] Admin-Backend laeuft bereits auf Port 3000 - kein Doppelstart.
    goto open_browser
)

REM 4. Backend starten
echo [INFO] Starte Admin-Backend (Node.js API-Bridge zu COBOL)...
start "COBOL CoreBank Admin" /min node "%~dp0backend\server.js"

REM 5. Warten bis Port 3000 aktiv ist (max. 10 Sekunden)
echo [INFO] Warte auf Initialisierung der COBOL-Schnittstelle...
set /a attempts=0

:check_loop
timeout /t 1 /nobreak >nul 2>&1
netstat -ano | findstr ":3000 " | findstr ":0 " >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [ERFOLG] Admin Interface ist online!
    goto open_browser
)

set /a attempts+=1
if %attempts% geq 10 (
    echo [WARNUNG] Server-Antwort verzoegert. Browser wird dennoch geoeffnet...
    goto open_browser
)
goto check_loop

:open_browser
echo [INFO] Oeffne Admin Interface im Standard-Browser...
start "" "http://localhost:3000"
echo.
echo =======================================================
echo   Admin Interface: http://localhost:3000
echo   PostgreSQL:      localhost:5432 / cobolbank
echo   Zum Stoppen:     stop.bat
echo =======================================================
echo.
timeout /t 3 /nobreak >nul 2>&1
exit /b 0
