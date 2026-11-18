/**
 * Logitech G-HUB Launch & Runtime Synchronization Utilities
 * Provides bulletproof Windows execution commands, batch files, and PowerShell auto-injectors.
 */

import { getMandatoryGHubScriptDir } from './ghubDirectoryConfig';

export const DEFAULT_GHUB_PATHS = [
  'C:\\Program Files\\LGHUB\\lghub.exe',
  'C:\\Program Files\\LGHUB\\system_tray\\lghub_system_tray.exe',
  '%ProgramFiles%\\LGHUB\\lghub.exe',
  '%LOCALAPPDATA%\\Programs\\LGHUB\\lghub.exe',
];

export function getGHubWindowsCommand(): string {
  return 'start "" "C:\\Program Files\\LGHUB\\lghub.exe"';
}

export function getGHubPowerShellCommand(): string {
  return 'Start-Process -FilePath "$env:ProgramFiles\\LGHUB\\lghub.exe"';
}

/**
 * Generates a ready-to-run Windows batch (.bat) launcher script.
 * Accurately references the mandatory selected G-HUB scripts directory,
 * creates the folder if missing, and injects the Lua script.
 */
export function generateGHubLaunchBatchScript(luaScript: string, customDir?: string): string {
  const scriptDir = customDir || getMandatoryGHubScriptDir();
  return `@echo off
setlocal EnableDelayedExpansion
title Rocket League Master Engine - Logitech G HUB 1000Hz Launcher
call :Log STEP "Starting Logitech G HUB 1000Hz launcher"

:: 1. Lock Mandatory G-HUB Scripts Directory
set "GHUB_DIR=${scriptDir}"
call :Log INFO "Mandatory G-HUB directory: %GHUB_DIR%"
if not exist "%GHUB_DIR%" (
    call :Log INFO "Creating target directory: %GHUB_DIR%"
    mkdir "%GHUB_DIR%" 2>nul
)

set "FOUND_EXE="
if exist "%ProgramFiles%\\LGHUB\\lghub.exe" set "FOUND_EXE=%ProgramFiles%\\LGHUB\\lghub.exe"
if not defined FOUND_EXE if exist "%ProgramFiles(x86)%\\LGHUB\\lghub.exe" set "FOUND_EXE=%ProgramFiles(x86)%\\LGHUB\\lghub.exe"
if not defined FOUND_EXE if exist "%LocalAppData%\\Programs\\LGHUB\\lghub.exe" set "FOUND_EXE=%LocalAppData%\\Programs\\LGHUB\\lghub.exe"
if not defined FOUND_EXE if exist "%ProgramFiles%\\LGHUB\\system_tray\\lghub_system_tray.exe" set "FOUND_EXE=%ProgramFiles%\\LGHUB\\system_tray\\lghub_system_tray.exe"

if defined FOUND_EXE (
    call :Log INFO "Starting Logitech G HUB executable: %FOUND_EXE%"
    start "" "%FOUND_EXE%"
    call :Log OK "Logitech G HUB dispatched"
) else (
    call :Log WARN "Standard executable path not found; invoking protocol lghub://"
    start "" "lghub://"
)

call :Log STEP "Deploying 1000Hz Lua script and syncing clipboard"
powershell -Command "$Script = @'\n${luaScript.replace(/'/g, "''")}\n'@; [System.IO.File]::WriteAllText((Join-Path ([System.Environment]::ExpandEnvironmentVariables('${scriptDir}')) 'rl_master_engine.lua'), $Script, [System.Text.Encoding]::UTF8); Set-Clipboard -Value $Script"

call :Log OK "1000Hz Lua script written to %GHUB_DIR% and copied to clipboard"
timeout /t 4 >nul
exit /b 0

:Log
set "LOG_LVL=%~1"
set "LOG_MSG=%~2"
if /i "%FNPRO_QUIET%"=="1" if /i "!LOG_LVL!"=="INFO" goto :eof
set "LOG_TS=%TIME:~0,8%"
set "LOG_TS=!LOG_TS: =0!"
echo [!LOG_TS!][FNPro][!LOG_LVL!] !LOG_MSG!
goto :eof
`;
}

/**
 * Generates a PowerShell (.ps1) script that starts G-HUB and writes
 * the Lua script directly to the mandatory Logitech scripts folder.
 */
export function generateGHubLaunchPowerShellScript(luaScript: string, customDir?: string): string {
  const targetDir = customDir || getMandatoryGHubScriptDir();
  const escapedLua = luaScript.replace(/`/g, '``').replace(/"/g, '`"');
  return `# Rocket League Master Engine - Logitech G HUB 1000Hz Launcher & Injector
param([switch]$Quiet = $false)

function Write-EngineLog {
    param([ValidateSet("STEP","INFO","OK","WARN","ERROR")][string]$Level, [string]$Message)
    if ($Quiet -and $Level -eq "INFO") { return }
    $colorMap = @{ STEP = "Cyan"; INFO = "DarkGray"; OK = "Green"; WARN = "Yellow"; ERROR = "Red" }
    Write-Host ("[{0}][FNPro][{1}] {2}" -f (Get-Date -Format "HH:mm:ss"), $Level, $Message) -ForegroundColor $colorMap[$Level]
}

Write-EngineLog -Level "STEP" -Message "Checking Logitech G HUB installation"

$LGHUB_Paths = @(
    "$env:ProgramFiles\\LGHUB\\lghub.exe",
    "\${env:ProgramFiles(x86)}\\LGHUB\\lghub.exe",
    "$env:LOCALAPPDATA\\Programs\\LGHUB\\lghub.exe",
    "$env:ProgramFiles\\LGHUB\\system_tray\\lghub_system_tray.exe"
)

$FoundGHub = $null
foreach ($p in $LGHUB_Paths) {
    if (Test-Path $p) {
        $FoundGHub = $p
        break
    }
}

if ($FoundGHub) {
    Write-EngineLog -Level "INFO" -Message "Launching Logitech G HUB: $FoundGHub"
    Start-Process -FilePath $FoundGHub
    Write-EngineLog -Level "OK" -Message "Logitech G HUB process started"
} else {
    Write-EngineLog -Level "WARN" -Message "Executable not in default paths; invoking lghub:// protocol"
    Start-Process "lghub://"
}

# Auto-inject Lua script into mandatory LGHUB scripts folder
$RawDir = "${targetDir}"
$ScriptDir = [System.Environment]::ExpandEnvironmentVariables($RawDir)
if (-not (Test-Path $ScriptDir)) {
    New-Item -ItemType Directory -Path $ScriptDir -Force | Out-Null
}

$TargetLua = [System.IO.Path]::Combine($ScriptDir, "rl_master_engine.lua")
$LuaPayload = @"
${escapedLua}
"@

[System.IO.File]::WriteAllText($TargetLua, $LuaPayload, [System.Text.Encoding]::UTF8)
Set-Clipboard -Value $LuaPayload
Write-EngineLog -Level "OK" -Message "Lua 1000Hz engine deployed to $TargetLua and copied to clipboard"
`;
}

