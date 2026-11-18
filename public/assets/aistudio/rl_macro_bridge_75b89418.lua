-- Logitech G502 X & PRO X Macro Bridge for FN-WIKILIFE RL Engine
local PhysicsEngine = require("core.fn_physics_core")

local MacroBridge = {
    mouse_button_trigger = 5, -- G502 X side button mapping
    active_binding = true
}

function MacroBridge.dispatch_auto_stall(pitch, yaw)
    if not MacroBridge.active_binding then return end
    
    print(string.format("[LOGITECH G502X] Dispatching Auto-Stall Macro -> Pitch: %.3f | Yaw: %.3f", pitch, yaw))
    
    -- Hardware level macro trigger simulation for Logitech G-Hub Lua runtime
    -- Press and release jump/air-roll sequence optimized for instant stall
    PressKey("LShift")
    PressMouseButton(MacroBridge.mouse_button_trigger)
    Sleep(14)
    ReleaseMouseButton(MacroBridge.mouse_button_trigger)
    ReleaseKey("LShift")
end

function MacroBridge.poll_and_execute()
    local success, stall_data = PhysicsEngine.evaluate_g502x_auto_stall()
    if success and stall_data then
        MacroBridge.dispatch_auto_stall(stall_data.pitch, stall_data.yaw)
    end
end

return MacroBridge
