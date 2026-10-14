@echo off
cd /d "%~dp0"
echo === Vantyx Hub: generando .exe ===
call npm install || goto :err
call npm run dist || goto :err
echo.
echo Listo. Los .exe estan en la carpeta "dist".
explorer dist
pause
exit /b 0
:err
echo Hubo un error. Revisa los mensajes de arriba.
pause
exit /b 1
