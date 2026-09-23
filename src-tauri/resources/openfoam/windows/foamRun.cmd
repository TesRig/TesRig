@echo off
setlocal
if not defined TESRIG_WSL_DISTRIBUTION set "TESRIG_WSL_DISTRIBUTION=Ubuntu"
wsl.exe --distribution "%TESRIG_WSL_DISTRIBUTION%" --exec bash -lc ". /opt/openfoam14/etc/bashrc && foamRun %*"
set "TESRIG_EXIT_CODE=%ERRORLEVEL%"
wsl.exe --terminate "%TESRIG_WSL_DISTRIBUTION%" >nul 2>&1
exit /b %TESRIG_EXIT_CODE%
