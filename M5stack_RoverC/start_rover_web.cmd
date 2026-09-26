@echo off
setlocal
cd /d "%~dp0rover-python"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment is missing. See Readme.md for setup.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" web_bridge_server.py --web
if errorlevel 1 pause
endlocal
