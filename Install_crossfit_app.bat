@echo off
title hecTHOR WOD - Servidor
cd /d "%~dp0"

echo ============================================================
echo   HECTHOR WOD - INICIANDO APP
echo ============================================================
echo.

set "VENV_PY=%~dp0.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo [1/3] Creando entorno virtual Python...
    py -m venv "%~dp0.venv"
    if errorlevel 1 python -m venv "%~dp0.venv"
    if not exist "%VENV_PY%" (
        echo [ERROR] No se encontro Python. Instala Python 3.10+ y vuelve a intentarlo.
        pause
        exit /b 1
    )
    echo [2/3] Instalando dependencias...
    "%VENV_PY%" -m pip install -r "%~dp0requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Fallo al instalar dependencias.
        pause
        exit /b 1
    )
)

rem Comprobar regla de firewall (sin pedir admin si ya existe)
netsh advfirewall firewall show rule name="CrossFit FastAPI" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Configurando regla de firewall para el puerto 8000...
    net session >nul 2>&1
    if errorlevel 1 (
        powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"CrossFit FastAPI\" dir=in action=allow protocol=TCP localport=8000 enable=yes profile=any' -Verb RunAs -Wait" >nul 2>&1
    ) else (
        netsh advfirewall firewall add rule name="CrossFit FastAPI" dir=in action=allow protocol=TCP localport=8000 enable=yes profile=any >nul 2>&1
    )
)

echo.
echo   URL en este PC:      http://127.0.0.1:8000/
for /f "usebackq delims=" %%I in (`"%VENV_PY%" -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()" 2^>nul`) do (
    echo   URL en tu MOVIL:     http://%%I:8000/alumnos
)
echo.
echo   Para pasar la app al movil: pulsa "Abrir / Pasar al Movil" en el navegador
echo   y escanea el codigo QR con tu telefono (misma red Wi-Fi privada).
echo   Manten esta ventana abierta mientras uses la app.
echo ============================================================
echo.

rem Abrir el navegador automaticamente tras 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000/"

"%VENV_PY%" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

echo.
echo [INFO] El servidor se ha detenido.
pause
