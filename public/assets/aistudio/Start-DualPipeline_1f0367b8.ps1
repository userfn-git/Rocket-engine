<#
.SYNOPSIS
    FN Physics Engine - Dual Pipeline Automation Runner (Lua 5.4 ABI Matched)
.DESCRIPTION
    Starts the Python SHM Telemetry Bridge, executes the Lua 5.4 Physics Engine loop, and validates G502 X Macro Bridge latency.
#>

$ErrorActionPreference = "Stop"
$repoDir  = "D:\fn_physics_engine"
$lua54Exe = "D:\Lua\lua.exe"

Set-Location $repoDir
$env:PATH      = "D:\fn_physics_engine\core;D:\Lua;$env:PATH"
$env:LUA_CPATH = "D:\fn_physics_engine\core\?.dll;D:\fn_physics_engine\?.dll;;"
$env:LUA_PATH  = "D:\fn_physics_engine\?.lua;D:\fn_physics_engine\core\?.lua;D:\fn_physics_engine\lua\?.lua;;"

Write-Host "[*] Initializing FN-WIKILIFE Dual Execution Pipeline (Lua 5.4 ABI)..." -ForegroundColor Cyan

# 1. Start Python SHM Bridge in background from hardware_daemon
Write-Host "[+] Launching Python SHM Telemetry Bridge..." -ForegroundColor Green
$bridgeJob = Start-Job -ScriptBlock {
    Set-Location "D:\fn_physics_engine"
    python "hardware_daemon\pyrocketsim_shm_bridge.py"
}

Start-Sleep -Seconds 1

# 2. Run Lua 5.4 Physics Loop from core
Write-Host "[+] Executing Lua 5.4 Physics Core Simulation Ticks..." -ForegroundColor Green
$luaCoreCode = '
local engine = require("core.fn_physics_core")
print("[LUA 5.4 ENGINE] Active and polling SHM telemetry...")
for i = 1, 50 do
    engine.update(0.016, 0.5, 0.5, true)
    if i % 25 == 0 then
        print(string.format("[TICK #%d] Wheels Touching: %d | Flip Reset Ready: %s", i, engine.car.wheels_touching_ball, tostring(engine.car.flip_reset_ready)))
    end
end
'
$luaCoreCode | & $lua54Exe -

# 3. Test G502 X Macro Bridge Performance & Tail Latency Percentiles
Write-Host "[+] Validating Logitech G502 X Macro Bridge Performance..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$luaMacroCode = '
local has_socket, socket = pcall(require, "socket")
local now = has_socket and socket.gettime or os.clock
local iterations = 1000

local success, bridge = pcall(require, "core.rl_macro_bridge")
if success and bridge then
    for _ = 1, 50 do
        bridge.poll_and_execute()
    end

    local samples = {}
    for i = 1, iterations do
        samples[i] = 0.0
    end

    local sum_us = 0.0
    for i = 1, iterations do
        local t0 = now()
        bridge.poll_and_execute()
        local dt_us = (now() - t0) * 1e6
        samples[i] = dt_us
        sum_us = sum_us + dt_us
    end

    table.sort(samples)
    local min_us = samples[1]
    local avg_us = sum_us / iterations
    local p95_us = samples[math.ceil(iterations * 0.95)]
    local p99_us = samples[math.ceil(iterations * 0.99)]

    print(string.format(
        "[MACRO TEST] N=%d | min=%.2f us | avg=%.2f us | p95=%.2f us | p99=%.2f us | timer=%s",
        iterations, min_us, avg_us, p95_us, p99_us, has_socket and "QPC" or "os.clock"
    ))
else
    print("[MACRO TEST WARNING] " .. tostring(bridge))
end
'
$luaMacroCode | & $lua54Exe -
$sw.Stop()
Write-Host ("[+] End-to-end Lua 5.4 macro step wall time: {0:N3} ms" -f $sw.Elapsed.TotalMilliseconds) -ForegroundColor DarkCyan

# 4. Clean up background jobs safely
Write-Host "[+] Shutting down telemetry bridge..." -ForegroundColor Yellow
if ($bridgeJob) {
    Stop-Job $bridgeJob -ErrorAction SilentlyContinue
    Remove-Job $bridgeJob -ErrorAction SilentlyContinue
}

Write-Host "[+] Dual execution pipeline & macro check completed successfully!" -ForegroundColor Green