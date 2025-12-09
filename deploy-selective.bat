@echo off
REM Windows batch wrapper for WSL deployment script
REM This allows you to run deployment from Windows CMD/PowerShell

echo ========================================
echo KADI Selective Deployment (WSL)
echo ========================================
echo.

REM Check if .env.production exists
if not exist ".env.production" (
    echo ERROR: .env.production not found!
    echo Please create .env.production from .env.production.template
    exit /b 1
)

echo Starting deployment through WSL...
echo.

wsl bash deploy-to-napoftheearth-selective.sh

echo.
echo ========================================
echo Deployment Complete!
echo ========================================
