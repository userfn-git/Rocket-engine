import ctypes
import mmap
import math
import time
import sys

# Optional PyRocketSim import with built-in kinematic fallback for instant testing
try:
    import RocketSim as rs
    HAS_ROCKETSIM = True
except ImportError:
    HAS_ROCKETSIM = False

# ==============================================================================
# 1. Exact Byte-Aligned Memory Structures (Matches C++ #pragma pack(push, 1))
# ==============================================================================
class Vec3(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("x", ctypes.c_float),
        ("y", ctypes.c_float),
        ("z", ctypes.c_float),
    ]

class HardwareInputState(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("raw_x", ctypes.c_float),
        ("raw_y", ctypes.c_float),
        ("out_x", ctypes.c_float),
        ("out_y", ctypes.c_float),
        ("active", ctypes.c_bool),
        ("connected", ctypes.c_bool),
        ("slot", ctypes.c_uint32),
        ("is_boosting", ctypes.c_bool),
    ]

class CarPhysicsState(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("pos", Vec3),
        ("vel", Vec3),
        ("ang_vel", Vec3),
        ("rot_euler", Vec3),
        ("speed", ctypes.c_float),
        ("wheels_touching_ball", ctypes.c_uint32),
        ("flip_reset_ready", ctypes.c_bool),
        ("total_resets_detected", ctypes.c_uint32),
    ]

class BallState(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("pos", Vec3),
        ("vel", Vec3),
        ("radius", ctypes.c_float),
    ]

class PhysicsEngineMemory(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("frame_index", ctypes.c_uint32),
        ("hw", HardwareInputState),
        ("car", CarPhysicsState),
        ("ball", BallState),
        ("collision_predicted", ctypes.c_bool),
        ("time_to_impact_sec", ctypes.c_float),
    ]

SHM_NAME = "Local\\FN_PHYSICS_CORE_MMF"
SHM_SIZE = ctypes.sizeof(PhysicsEngineMemory)

def rot_mat_to_euler(forward, right, up):
    # Convert RocketSim basis vectors to Euler angles (Pitch, Yaw, Roll)
    pitch = math.asin(max(-1.0, min(1.0, forward.z)))
    yaw = math.atan2(forward.y, forward.x)
    roll = math.atan2(-right.z, up.z)
    return pitch, yaw, roll

def run_bridge():
    print("========================================================================")
    print(" FN PyRocketSim <-> C++ Master Core Shared Memory Bridge (120Hz)")
    print(f" Buffer Name : {SHM_NAME} ({SHM_SIZE} bytes)")
    print(f" Backend Mode: {'Native PyRocketSim (Bullet)' if HAS_ROCKETSIM else 'Kinematic Aerial Simulator (Fallback)'}")
    print("========================================================================\n")

    try:
        shm_mmap = mmap.mmap(-1, SHM_SIZE, tagname=SHM_NAME, access=mmap.ACCESS_WRITE)
        mem = PhysicsEngineMemory.from_buffer(shm_mmap)
    except Exception as e:
        print(f"[-] Failed to attach to Shared Memory. Make sure fn_physics_core.exe is running!\n    Error: {e}")
        sys.exit(1)

    if HAS_ROCKETSIM:
        rs.init("collision_meshes")
        arena = rs.Arena(rs.GameMode.SOCCAR)
        car = arena.add_car(rs.Team.BLUE, rs.CarConfig.OCTANE)
        
        # Setup mid-air flip reset training state
        b_state = rs.BallState()
        b_state.pos = rs.Vec(0.0, 1000.0, 950.0)
        b_state.vel = rs.Vec(0.0, -250.0, 220.0)
        arena.ball.set_state(b_state)

        c_state = rs.CarState()
        c_state.pos = rs.Vec(0.0, 650.0, 780.0)
        c_state.vel = rs.Vec(0.0, 480.0, 310.0)
        c_state.boost = 100.0
        car.set_state(c_state)
    else:
        # Fallback initial state for testing C++ 4-wheel contact without collision_meshes
        mem.ball.pos.x, mem.ball.pos.y, mem.ball.pos.z = 0.0, 1000.0, 950.0
        mem.ball.vel.x, mem.ball.vel.y, mem.ball.vel.z = 0.0, -150.0, 120.0
        mem.car.pos.x, mem.car.pos.y, mem.car.pos.z = 0.0, 820.0, 830.0
        mem.car.vel.x, mem.car.vel.y, mem.car.vel.z = 0.0, 260.0, 190.0

    tick_dt = 1.0 / 120.0
    print("[+] Bridge Locked & Streaming at 120Hz! Press Ctrl+C to stop.\n")

    try:
        while True:
            t_start = time.perf_counter()

            # Read smoothed hardware inputs from C++ Core
            steer_yaw = mem.hw.out_x if mem.hw.active else 0.0
            pitch_val = mem.hw.out_y if mem.hw.active else 0.0
            boosting  = mem.hw.is_boosting

            if HAS_ROCKETSIM:
                controls = rs.CarControls()
                controls.steer = steer_yaw
                controls.yaw = steer_yaw
                controls.pitch = pitch_val
                controls.boost = boosting
                controls.throttle = 1.0 if boosting else 0.0
                car.set_controls(controls)

                arena.step(1)

                cs = car.get_state()
                bs = arena.ball.get_state()

                # Write Car Coordinates & Rotation to C++ Core
                mem.car.pos.x, mem.car.pos.y, mem.car.pos.z = cs.pos.x, cs.pos.y, cs.pos.z
                mem.car.vel.x, mem.car.vel.y, mem.car.vel.z = cs.vel.x, cs.vel.y, cs.vel.z
                p, y, r = rot_mat_to_euler(cs.rot_mat.forward, cs.rot_mat.right, cs.rot_mat.up)
                mem.car.rot_euler.x, mem.car.rot_euler.y, mem.car.rot_euler.z = p, y, r

                # Write Ball Coordinates to C++ Core
                mem.ball.pos.x, mem.ball.pos.y, mem.ball.pos.z = bs.pos.x, bs.pos.y, bs.pos.z
                mem.ball.vel.x, mem.ball.vel.y, mem.ball.vel.z = bs.vel.x, bs.vel.y, bs.vel.z
            else:
                # Kinematic integration step
                mem.ball.vel.z -= 650.0 * tick_dt
                mem.ball.pos.x += mem.ball.vel.x * tick_dt
                mem.ball.pos.y += mem.ball.vel.y * tick_dt
                mem.ball.pos.z += mem.ball.vel.z * tick_dt

                if boosting:
                    mem.car.vel.y += 991.666 * tick_dt
                    mem.car.vel.z += 400.0 * tick_dt
                mem.car.vel.z -= 650.0 * tick_dt
                mem.car.pos.x += mem.car.vel.x * tick_dt
                mem.car.pos.y += mem.car.vel.y * tick_dt
                mem.car.pos.z += mem.car.vel.z * tick_dt

                # Reset loop if ball hits floor
                if mem.ball.pos.z < 92.0:
                    mem.ball.pos.x, mem.ball.pos.y, mem.ball.pos.z = 0.0, 1000.0, 950.0
                    mem.ball.vel.x, mem.ball.vel.y, mem.ball.vel.z = 0.0, -150.0, 120.0
                    mem.car.pos.x, mem.car.pos.y, mem.car.pos.z = 0.0, 820.0, 830.0
                    mem.car.vel.x, mem.car.vel.y, mem.car.vel.z = 0.0, 260.0, 190.0

            # Live Telemetry Display
            wheels = mem.car.wheels_touching_ball
            reset_flag = "READY [4/4]" if mem.car.flip_reset_ready else f"TOUCH [{wheels}/4]"
            sys.stdout.write(
                f"\r[120Hz] Car:({mem.car.pos.x:6.1f},{mem.car.pos.y:6.1f},{mem.car.pos.z:6.1f}) | "
                f"Ball:({mem.ball.pos.x:6.1f},{mem.ball.pos.y:6.1f},{mem.ball.pos.z:6.1f}) | "
                f"Status: {reset_flag} | Total Resets: {mem.car.total_resets_detected}   "
            )
            sys.stdout.flush()

            elapsed = time.perf_counter() - t_start
            if elapsed < tick_dt:
                time.sleep(tick_dt - elapsed)

    except KeyboardInterrupt:
        print("\n[*] Bridge stopped cleanly.")
    finally:
        del mem
        shm_mmap.close()

if __name__ == "__main__":
    run_bridge()
