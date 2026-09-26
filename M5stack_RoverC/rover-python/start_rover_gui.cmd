@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Python environment is missing. Run: python -m venv .venv
  pause
  exit /b 1
)
start "RoverC Pro Remote" ".venv\Scripts\pythonw.exe" "app.py"
endlocal
