-- [FN-WIKILIFE] Native Win32 Seqlock SHM Integration (fn_shm.dll - Zero-Allocation Numeric Unpacker)
package.cpath = [[D:\fn_physics_engine\?.dll;]] .. package.cpath
local has_fn_shm, fn_shm = pcall(require, "fn_shm")
local SHM_TAGNAME   = "fn_rocket_league_telemetry_shm"
local SHM_BYTES     = 1024
local SHM_MAGIC     = 0x464E524C
local shm_view      = nil
local read_frame_fn = nil

local RL_LINEAR_DRAG    = 0.030
local RL_ANGULAR_DRAG   = 0.005
local LOCKED_DEADZONE   = 0.050
local SMOOTH_ALPHA      = 0.350
local WHEEL_CONTACT_TOL = 8.5
local BASE_STALL_DELAY  = 14

local PhysicsEngine = {
    car = {
        pos = { x = 0, y = 0, z = 0 },
        vel = { x = 0, y = 0, z = 0 },
        ang_vel = { x = 0, y = 0, z = 0 },
        rot_euler = { x = 0, y = 0, z = 0 },
        speed = 0,
        wheels_touching_ball = 0,
        flip_reset_ready = false,
        total_resets_detected = 0,
        stall_triggered = false
    },
    ball = {
        pos = { x = 0, y = 0, z = 0 },
        vel = { x = 0, y = 0, z = 0 },
        radius = 91.25
    },
    prev_x = 0,
    prev_y = 0,
    prev_reset_state = false
}

function PhysicsEngine.read_shared_memory_telemetry()
    if not has_fn_shm then
        return false
    end

    if not shm_view then
        local ok, view_or_err = pcall(fn_shm.open, SHM_TAGNAME, SHM_BYTES)
        if not ok then
            return false
        end
        shm_view      = view_or_err
        read_frame_fn = shm_view.read_frame_seqlock
    end

    -- Unpack 68-byte frame directly onto Lua stack as 16 numbers (0 string/table allocations)
    local seq, magic, tick, wheels,
          cx, cy, cz, cvx, cvy, cvz,
          bx, by, bz, bvx, bvy, bvz = read_frame_fn(shm_view, 0, 1000)

    if not seq or magic ~= SHM_MAGIC then
        return false
    end

    PhysicsEngine.shm_seq  = seq
    PhysicsEngine.shm_tick = tick

    local car = PhysicsEngine.car
    if car then
        car.wheels_touching_ball = wheels
        car.flip_reset_ready     = (wheels == 4)
        local cpos = car.pos
        if cpos then cpos.x, cpos.y, cpos.z = cx, cy, cz end
        local cvel = car.vel
        if cvel then cvel.x, cvel.y, cvel.z = cvx, cvy, cvz end
    end

    local ball = PhysicsEngine.ball
    if ball then
        local bpos = ball.pos
        if bpos then bpos.x, bpos.y, bpos.z = bx, by, bz end
        local bvel = ball.vel
        if bvel then bvel.x, bvel.y, bvel.z = bvx, bvy, bvz end
    end

    return true
end

function PhysicsEngine.process_deadzone(in_x, in_y)
    local filtered_x = (SMOOTH_ALPHA * in_x) + ((1.0 - SMOOTH_ALPHA) * PhysicsEngine.prev_x)
    local filtered_y = (SMOOTH_ALPHA * in_y) + ((1.0 - SMOOTH_ALPHA) * PhysicsEngine.prev_y)
    PhysicsEngine.prev_x = filtered_x
    PhysicsEngine.prev_y = filtered_y

    local mag = math.sqrt(filtered_x * filtered_x + filtered_y * filtered_y)
    if mag <= LOCKED_DEADZONE then
        return 0.0, 0.0, false
    end

    local norm_x = filtered_x / mag
    local norm_y = filtered_y / mag
    local t = math.min(1.0, (mag - LOCKED_DEADZONE) / (1.0 - LOCKED_DEADZONE))
    local smooth_t = t * t * (3.0 - 2.0 * t)

    return norm_x * smooth_t, norm_y * smooth_t, true
end

function PhysicsEngine.rotate_point(p, euler)
    local cp, sp = math.cos(euler.x), math.sin(euler.x)
    local cy, sy = math.cos(euler.y), math.sin(euler.y)
    local cr, sr = math.cos(euler.z), math.sin(euler.z)

    local x1 = p.x * cr - p.y * sr
    local y1 = p.x * sr + p.y * cr
    local z1 = p.z

    local x2 = x1
    local y2 = y1 * cp - z1 * sp
    local z2 = y1 * sp + z1 * cp

    return {
        x = x2 * cy + z2 * sy,
        y = y2,
        z = -x2 * sy + z2 * cy
    }
end

function PhysicsEngine.evaluate_wheels()
    local local_wheels = {
        { x =  51.2, y = -33.0, z = -18.5 },
        { x =  51.2, y =  33.0, z = -18.5 },
        { x = -42.5, y = -34.5, z = -18.5 },
        { x = -42.5, y =  34.5, z = -18.5 }
    }

    local touching_count = 0
    local contact_threshold = PhysicsEngine.ball.radius + WHEEL_CONTACT_TOL

    for i = 1, 4 do
        local world_offset = PhysicsEngine.rotate_point(local_wheels[i], PhysicsEngine.car.rot_euler)
        local wheel_world = {
            x = PhysicsEngine.car.pos.x + world_offset.x,
            y = PhysicsEngine.car.pos.y + world_offset.y,
            z = PhysicsEngine.car.pos.z + world_offset.z
        }

        local dx = wheel_world.x - PhysicsEngine.ball.pos.x
        local dy = wheel_world.y - PhysicsEngine.ball.pos.y
        local dz = wheel_world.z - PhysicsEngine.ball.pos.z
        local dist = math.sqrt(dx * dx + dy * dy + dz * dz)

        if dist <= contact_threshold then
            touching_count = touching_count + 1
        end
    end

    PhysicsEngine.car.wheels_touching_ball = touching_count
    PhysicsEngine.car.flip_reset_ready = (touching_count == 4)

    if PhysicsEngine.car.flip_reset_ready and not PhysicsEngine.prev_reset_state then
        PhysicsEngine.car.total_resets_detected = PhysicsEngine.car.total_resets_detected + 1
        PhysicsEngine.car.stall_triggered = false
        print(string.format("\n[***] 4-WHEEL FLIP RESET LOCKED! | Chain Count: %d", PhysicsEngine.car.total_resets_detected))
    end
    PhysicsEngine.prev_reset_state = PhysicsEngine.car.flip_reset_ready
end

function PhysicsEngine.trigger_g502x_macro(pitch, yaw)
    print(string.format("[G502X MACRO] Executing Auto-Stall Pulse -> Pitch: %.3f | Yaw: %.3f", pitch, yaw))
end

function PhysicsEngine.evaluate_g502x_auto_stall()
    if PhysicsEngine.car.flip_reset_ready and not PhysicsEngine.car.stall_triggered then
        local rel_x = PhysicsEngine.ball.pos.x - PhysicsEngine.car.pos.x
        local rel_y = PhysicsEngine.ball.pos.y - PhysicsEngine.car.pos.y
        local rel_z = PhysicsEngine.ball.pos.z - PhysicsEngine.car.pos.z
        
        local target_pitch = PhysicsEngine.car.rot_euler.x + (rel_z * 0.015)
        local target_yaw   = PhysicsEngine.car.rot_euler.y + (rel_y * 0.015)
        
        PhysicsEngine.car.stall_triggered = true
        PhysicsEngine.trigger_g502x_macro(target_pitch, target_yaw)
        
        return true, {
            pitch = target_pitch,
            yaw = target_yaw,
            roll = 1.0,
            delay_ms = BASE_STALL_DELAY
        }
    end
    return false, nil
end

function PhysicsEngine.update(dt, raw_x, raw_y, is_boosting)
    -- Pull live telemetry frame from Shared Memory buffer
    PhysicsEngine.read_shared_memory_telemetry()

    local out_x, out_y, active = PhysicsEngine.process_deadzone(raw_x, raw_y)

    PhysicsEngine.car.vel.x = PhysicsEngine.car.vel.x - PhysicsEngine.car.vel.x * RL_LINEAR_DRAG * dt
    PhysicsEngine.car.vel.y = PhysicsEngine.car.vel.y - PhysicsEngine.car.vel.y * RL_LINEAR_DRAG * dt
    PhysicsEngine.car.vel.z = PhysicsEngine.car.vel.z - PhysicsEngine.car.vel.z * RL_LINEAR_DRAG * dt

    if active then
        local assist = is_boosting and 5.5 or 12.5
        PhysicsEngine.car.ang_vel.y = out_y * assist
        PhysicsEngine.car.ang_vel.z = out_x * assist
        PhysicsEngine.car.rot_euler.x = PhysicsEngine.car.rot_euler.x + PhysicsEngine.car.ang_vel.y * dt
        PhysicsEngine.car.rot_euler.y = PhysicsEngine.car.rot_euler.y + PhysicsEngine.car.ang_vel.z * dt
    end

    PhysicsEngine.evaluate_wheels()
    PhysicsEngine.evaluate_g502x_auto_stall()
end

return PhysicsEngine

