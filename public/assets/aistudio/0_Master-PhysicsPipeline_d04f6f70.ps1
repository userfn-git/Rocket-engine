$ErrorActionPreference = "SilentlyContinue"
$EngineRoot  = "D:\fn_physics_engine"
$ScriptsDir  = "$EngineRoot\scripts"
$LuaWin64Dir = "$EngineRoot\lua\win64"
$BinWin64Dir = "$EngineRoot\bin\win64"

# Step A: Ensure Lua 5.4 Win64 DLL is present in both lua\win64 and bin\win64
if (-not (Test-Path -LiteralPath "$LuaWin64Dir\lua54.dll")) {
    if (Test-Path -LiteralPath "$ScriptsDir\1_Setup-LuaWin64.ps1") {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ScriptsDir\1_Setup-LuaWin64.ps1" | Out-Null
    }
}
if (Test-Path -LiteralPath "$LuaWin64Dir\lua54.dll") {
    Copy-Item -LiteralPath "$LuaWin64Dir\lua54.dll" -Destination "$BinWin64Dir\lua54.dll" -Force
}

# Step B: Compile KBM 0.05/0.05 Zone & Momentum Curves (JSON + HPP + LUA)
if (Test-Path -LiteralPath "$ScriptsDir\2_Compile-ProPhysics.ps1") {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ScriptsDir\2_Compile-ProPhysics.ps1" | Out-Null
}

# Step C: Apply official TAInput.ini 0.05 Deadzone & 0.0 KeyboardAxisBlendTime
if (Test-Path -LiteralPath "$ScriptsDir\5_Apply-TAInput.ps1") {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ScriptsDir\5_Apply-TAInput.ps1" | Out-Null
}

# Step D: Ensure Closed-Loop Relay & Auto-Watchdog are running
$RelayProc = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*3_Start-ClosedLoopRelay.ps1*" }
if (-not $RelayProc -and (Test-Path -LiteralPath "$ScriptsDir\3_Start-ClosedLoopRelay.ps1")) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptsDir\3_Start-ClosedLoopRelay.ps1`""
}

$WatchProc = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like "*4_GameAutoTrigger.ps1*" }
if (-not $WatchProc -and (Test-Path -LiteralPath "$ScriptsDir\4_GameAutoTrigger.ps1")) {
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptsDir\4_GameAutoTrigger.ps1`""
}
