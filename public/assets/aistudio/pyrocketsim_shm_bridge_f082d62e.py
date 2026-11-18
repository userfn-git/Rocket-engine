
# --- [WIN32 NAMED MUTEX SINGLE-INSTANCE GUARD] ---
import os as _os
import sys as _sys
import atexit as _atexit
import ctypes as _ctypes
from ctypes import wintypes as _wintypes

_SHM_MUTEX_HANDLE = None

def _acquire_single_instance_mutex():
    global _SHM_MUTEX_HANDLE
    if _os.name != "nt":
        return
    kernel32 = _ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [_wintypes.LPVOID, _wintypes.BOOL, _wintypes.LPCWSTR]
    kernel32.CreateMutexW.restype = _wintypes.HANDLE
    kernel32.ReleaseMutex.argtypes = [_wintypes.HANDLE]
    kernel32.ReleaseMutex.restype = _wintypes.BOOL
    kernel32.CloseHandle.argtypes = [_wintypes.HANDLE]
    kernel32.CloseHandle.restype = _wintypes.BOOL

    ERROR_ALREADY_EXISTS = 183
    ERROR_ACCESS_DENIED  = 5

    handle = kernel32.CreateMutexW(None, True, "Global\\FN_RocketSim_SHM_Bridge_Mutex")
    err = _ctypes.get_last_error()
    if not handle and err == ERROR_ACCESS_DENIED:
        handle = kernel32.CreateMutexW(None, True, "Local\\FN_RocketSim_SHM_Bridge_Mutex")
        err = _ctypes.get_last_error()

    if not handle:
        raise RuntimeError(f"[SHM MUTEX ERROR] CreateMutexW failed with Win32 error {err}")

    if err == ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        _sys.stderr.write("[SHM MUTEX LOCKED] Another pyrocketsim_shm_bridge instance is already active. Exiting.\n")
        _sys.exit(0)

    _SHM_MUTEX_HANDLE = handle

    def _release_mutex():
        global _SHM_MUTEX_HANDLE
        if _SHM_MUTEX_HANDLE:
            try:
                kernel32.ReleaseMutex(_SHM_MUTEX_HANDLE)
                kernel32.CloseHandle(_SHM_MUTEX_HANDLE)
            finally:
                _SHM_MUTEX_HANDLE = None

    _atexit.register(_release_mutex)

_acquire_single_instance_mutex()
# --- [END WIN32 NAMED MUTEX GUARD] ---
import mmap
import os
import struct
import tempfile
import time

try:
    import RocketSim as rs
except ImportError:
    try:
        import rocketsim as rs
    except ImportError:
        rs = None

SHM_NAME = "fn_rocket_league_telemetry_shm"
SHM_SIZE = 1024
SHM_MAGIC = 0x464E524C  # "FNRL"

SEQ_STRUCT = struct.Struct("<I")
FRAME_STRUCT = struct.Struct("<IQ I 3f 3f 3f 3f")  # 64 bytes at offset 4

MESH_SEARCH_PATHS = (
    r"D:\projects\fn_physics_engine\collision_meshes",
    r"D:\RL_Engine\collision_meshes",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "collision_meshes"),
)


def resolve_collision_meshes() -> str | None:
    env_path = os.getenv("ROCKETSIM_MESH_PATH")
    if env_path and os.path.isdir(env_path):
        return env_path
    for candidate in MESH_SEARCH_PATHS:
        norm = os.path.abspath(candidate)
        if os.path.isdir(norm):
            return norm
    return None


def initialize_shared_memory() -> mmap.mmap:
    if os.name == "nt":
        shm = mmap.mmap(-1, SHM_SIZE, tagname=SHM_NAME, access=mmap.ACCESS_WRITE)
    else:
        shm_path = os.path.join(tempfile.gettempdir(), f"{SHM_NAME}.shm")
        fd = os.open(shm_path, os.O_CREAT | os.O_RDWR, 0o666)
        os.ftruncate(fd, SHM_SIZE)
        os.close(fd)
        with open(shm_path, "r+b") as f:
            shm = mmap.mmap(f.fileno(), SHM_SIZE, access=mmap.ACCESS_WRITE)
    shm.seek(0)
    shm.write(b"\x00" * SHM_SIZE)
    return shm


def create_live_arena():
    if rs is None:
        return None, None, "RocketSim Python module not installed"

    mesh_dir = resolve_collision_meshes()
    if not mesh_dir:
        return None, None, "collision_meshes directory not found"

    rs.init(mesh_dir)
    arena = rs.Arena(rs.GameMode.SOCCAR)
    car = arena.add_car(rs.Team.BLUE, rs.CarConfig.OCTANE)

    # Set initial aerial setup state (car positioned under airborne ball for reset testing)
    ball_state = arena.ball.get_state()
    ball_state.pos = rs.Vec(0.0, 0.0, 950.0)
    ball_state.vel = rs.Vec(0.0, 120.0, 40.0)
    arena.ball.set_state(ball_state)

    car_state = car.get_state()
    car_state.pos = rs.Vec(0.0, -140.0, 820.0)
    car_state.vel = rs.Vec(0.0, 480.0, 310.0)
    car_state.boost = 100.0
    car.set_state(car_state)

    return arena, car, f"LIVE_ROCKETSIM ({mesh_dir})"


def write_seqlock_frame(
    shm: mmap.mmap,
    seq: int,
    tick: int,
    wheels_touching: int,
    car_pos: tuple,
    car_vel: tuple,
    ball_pos: tuple,
    ball_vel: tuple,
) -> int:
    # Step 1: Publish odd sequence number to signal active write
    odd_seq = (seq + 1) | 1
    SEQ_STRUCT.pack_into(shm, 0, odd_seq)

    # Step 2: Pack telemetry payload at byte offset 4
    FRAME_STRUCT.pack_into(
        shm,
        4,
        SHM_MAGIC,
        tick,
        wheels_touching,
        car_pos[0], car_pos[1], car_pos[2],
        car_vel[0], car_vel[1], car_vel[2],
        ball_pos[0], ball_pos[1], ball_pos[2],
        ball_vel[0], ball_vel[1], ball_vel[2],
    )

    # Step 3: Commit even sequence number once frame is coherent
    even_seq = odd_seq + 1
    SEQ_STRUCT.pack_into(shm, 0, even_seq)
    return even_seq


def run_bridge(hz: int = 120):
    shm = initialize_shared_memory()
    arena, car, mode_label = create_live_arena()
    print(f"[SHM BRIDGE] Active | Tag={SHM_NAME} | Size={SHM_SIZE}B | Mode={mode_label}", flush=True)

    dt = 1.0 / float(hz)
    seq = 0
    tick = 0
    next_deadline = time.perf_counter()

    try:
        while True:
            tick += 1

            if arena is not None and car is not None:
                # Apply aerial pitch/boost control input and step 1 RocketSim tick (1/120s)
                controls = rs.CarControls()
                controls.throttle = 1.0
                controls.boost = True
                controls.pitch = -0.35
                car.set_controls(controls)

                arena.step(1)

                c_state = car.get_state()
                b_state = arena.ball.get_state()

                # Count airborne wheel contacts (4 airborne contacts = flip reset surface lock)
                if not c_state.is_on_ground:
                    wheels = sum(1 for w in c_state.wheels_with_contact if w)
                else:
                    wheels = 0

                car_pos = (float(c_state.pos.x), float(c_state.pos.y), float(c_state.pos.z))
                car_vel = (float(c_state.vel.x), float(c_state.vel.y), float(c_state.vel.z))
                ball_pos = (float(b_state.pos.x), float(b_state.pos.y), float(b_state.pos.z))
                ball_vel = (float(b_state.vel.x), float(b_state.vel.y), float(b_state.vel.z))
            else:
                # Fallback pulse mode if RocketSim package or collision_meshes is absent
                wheels = 4 if (tick % 20 == 0) else 0
                car_pos = (0.0, 0.0, 17.01)
                car_vel = (0.0, 1400.0, 0.0)
                ball_pos = (0.0, 200.0, 93.15)
                ball_vel = (0.0, 0.0, 0.0)

            seq = write_seqlock_frame(
                shm, seq, tick, wheels, car_pos, car_vel, ball_pos, ball_vel
            )

            next_deadline += dt
            sleep_for = next_deadline - time.perf_counter()
            if sleep_for > 0.0015:
                time.sleep(sleep_for - 0.001)
            while time.perf_counter() < next_deadline:
                pass
    except KeyboardInterrupt:
        pass
    finally:
        shm.close()


if __name__ == "__main__":
    run_bridge(120)