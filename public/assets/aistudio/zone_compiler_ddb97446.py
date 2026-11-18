import json
import math
import os
import time

BASE_DIR    = r"D:\projects\fn_physics_engine"
OUTPUT_FILE = os.path.join(BASE_DIR, "io", "output", "telemetry_out.json")
INPUT_FILE  = os.path.join(BASE_DIR, "io", "input", "active_zone_input.json")
CPP_HEADER  = os.path.join(BASE_DIR, "io", "compiled", "zone_momentum.hpp")
LUA_PROFILE = os.path.join(BASE_DIR, "io", "compiled", "zone_momentum.lua")

KBM_PRO_DEFAULTS = {
    "profile_name": "FN_KBM_COMPETITIVE_005",
    "input_device": "KBM_DIGITAL_PRECISION",
    "inner_deadzone": 0.05,
    "outer_deadzone": 0.98,
    "dodge_deadzone": 0.05,
    "stall_yaw_tolerance": 0.085,
    "stall_flip_reset_lock": 0.96,
    "lightness_micro_gain": 1.26,
    "weight_momentum_retention": 0.95,
    "fast_aerial_pitch_bias": 1.14,
    "air_drag_compensation": 1.09,
    "angular_damping_floor": 0.14,
    "last_stick_vector": [0.0, 0.0]
}

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def compute_pro_zone_curve(raw_mag, d_in, d_out, light_gain, weight_retention, air_comp):
    if raw_mag <= d_in:
        return 0.0
    span = max(d_out - d_in, 1e-5)
    norm = clamp((raw_mag - d_in) / span, 0.0, 1.0)

    if norm < 0.45:
        stage_val = math.pow(norm / 0.45, 1.0 / light_gain) * 0.45
    else:
        upper_t = (norm - 0.45) / 0.55
        blended = math.pow(upper_t, 1.08) * weight_retention + upper_t * (1.0 - weight_retention)
        stage_val = 0.45 + blended * 0.55

    compensated = stage_val * (1.0 + (air_comp - 1.0) * (1.0 - norm * 0.35))
    return round(clamp(compensated, 0.0, 1.0), 6)

def compile_cycle():
    t0 = time.perf_counter()

    if not os.path.exists(OUTPUT_FILE):
        tel = dict(KBM_PRO_DEFAULTS)
    else:
        try:
            with open(OUTPUT_FILE, "r", encoding="utf-8") as f:
                tel = json.load(f)
        except Exception:
            tel = dict(KBM_PRO_DEFAULTS)

    tel["profile_name"]   = "FN_KBM_COMPETITIVE_005"
    tel["input_device"]   = "KBM_DIGITAL_PRECISION"
    tel["inner_deadzone"] = 0.05
    tel["dodge_deadzone"] = 0.05

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(tel, f, indent=2)

    d_in        = 0.05
    d_out       = float(tel.get("outer_deadzone", 0.98))
    d_dodge     = 0.05
    stall_tol   = float(tel.get("stall_yaw_tolerance", 0.085))
    reset_lock  = float(tel.get("stall_flip_reset_lock", 0.96))
    light_gain  = float(tel.get("lightness_micro_gain", 1.26))
    weight_ret  = float(tel.get("weight_momentum_retention", 0.95))
    fast_pitch  = float(tel.get("fast_aerial_pitch_bias", 1.14))
    air_comp    = float(tel.get("air_drag_compensation", 1.09))
    damp_floor  = float(tel.get("angular_damping_floor", 0.14))

    lut = [
        compute_pro_zone_curve(i / 255.0, d_in, d_out, light_gain, weight_ret, air_comp)
        for i in range(256)
    ]

    vx, vy = tel.get("last_stick_vector", [0.0, 0.0])
    if abs(vx) < stall_tol and abs(vy) > d_dodge:
        vx = 0.0
    vy_aerial = clamp(vy * fast_pitch, -1.0, 1.0)

    raw_r = math.hypot(vx, vy_aerial)
    if raw_r > 1e-6:
        scaled_r = compute_pro_zone_curve(raw_r, d_in, d_out, light_gain, weight_ret, air_comp)
        ratio = scaled_r / raw_r
        out_vx = round(clamp(vx * ratio, -1.0, 1.0), 6)
        out_vy = round(clamp(vy_aerial * ratio, -1.0, 1.0), 6)
    else:
        out_vx, out_vy = 0.0, 0.0

    input_payload = {
        "engine": "FNEngine-Win64",
        "profile": "FN_KBM_COMPETITIVE_005",
        "input_device": "KBM_DIGITAL_PRECISION",
        "timestamp": time.time(),
        "lua_dll_path": r"D:\projects\fn_physics_engine\lua\win64\lua54.dll",
        "mechanics": {
            "inner_deadzone": d_in,
            "outer_deadzone": d_out,
            "dodge_deadzone": d_dodge,
            "stall_yaw_tolerance": stall_tol,
            "stall_flip_reset_lock": reset_lock,
            "lightness_micro_gain": light_gain,
            "weight_momentum_retention": weight_ret,
            "fast_aerial_pitch_bias": fast_pitch,
            "air_drag_compensation": air_comp,
            "angular_damping_floor": damp_floor
        },
        "calibrated_vector": [out_vx, out_vy],
        "radial_lut_256": lut
    }
    with open(INPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(input_payload, f, indent=2)

    lut_cpp = ", ".join(f"{v:.6f}f" for v in lut)
    cpp_code = f"""#pragma once
#include <array>

namespace fn::physics::zone {{
    constexpr float INNER_DEADZONE            = {d_in:.6f}f;
    constexpr float OUTER_DEADZONE            = {d_out:.6f}f;
    constexpr float DODGE_DEADZONE            = {d_dodge:.6f}f;
    constexpr float STALL_YAW_TOLERANCE       = {stall_tol:.6f}f;
    constexpr float STALL_FLIP_RESET_LOCK     = {reset_lock:.6f}f;
    constexpr float LIGHTNESS_MICRO_GAIN      = {light_gain:.6f}f;
    constexpr float WEIGHT_MOMENTUM_RETENTION = {weight_ret:.6f}f;
    constexpr float FAST_AERIAL_PITCH_BIAS    = {fast_pitch:.6f}f;
    constexpr float AIR_DRAG_COMPENSATION     = {air_comp:.6f}f;
    constexpr float ANGULAR_DAMPING_FLOOR     = {damp_floor:.6f}f;

    constexpr std::array<float, 256> PRO_RADIAL_LUT = {{ {lut_cpp} }};
}}
"""
    with open(CPP_HEADER, "w", encoding="utf-8") as f:
        f.write(cpp_code)

    lua_lut = ", ".join(f"{v:.6f}" for v in lut)
    lua_code = f"""-- Auto-generated by FN-Physics Pro Zone Compiler (KBM 0.05/0.05)
local M = {{
    profile_name = "FN_KBM_COMPETITIVE_005",
    inner_deadzone = {d_in:.6f},
    outer_deadzone = {d_out:.6f},
    dodge_deadzone = {d_dodge:.6f},
    stall_yaw_tolerance = {stall_tol:.6f},
    stall_flip_reset_lock = {reset_lock:.6f},
    lightness_micro_gain = {light_gain:.6f},
    weight_momentum_retention = {weight_ret:.6f},
    fast_aerial_pitch_bias = {fast_pitch:.6f},
    air_drag_compensation = {air_comp:.6f},
    angular_damping_floor = {damp_floor:.6f},
    radial_lut = {{ {lua_lut} }}
}}

function M.sample_lut(norm_mag)
    local idx = math.floor(math.max(0.0, math.min(1.0, norm_mag)) * 255.0) + 1
    return M.radial_lut[idx]
end

return M
"""
    with open(LUA_PROFILE, "w", encoding="utf-8") as f:
        f.write(lua_code)

    ms = round((time.perf_counter() - t0) * 1000.0, 2)
    print(f"[2/5] Compiled KBM 0.05/0.05 Curves -> Input in {ms}ms")

if __name__ == "__main__":
    compile_cycle()
