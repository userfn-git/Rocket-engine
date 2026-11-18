#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <string.h>
#include <lua.h>
#include <lauxlib.h>

#define SHM_MT "FN.ShmView"
#define MAX_STACK_BUF 4096

#pragma pack(push, 1)
typedef struct {
    uint32_t seq;
    uint32_t magic;
    uint64_t tick;
    uint32_t wheels_touching;
    float car_pos[3];
    float car_vel[3];
    float ball_pos[3];
    float ball_vel[3];
} FNTelemetryFrame;
#pragma pack(pop)

typedef char fn_assert_frame_size[(sizeof(FNTelemetryFrame) == 68) ? 1 : -1];

typedef struct {
    HANDLE hMap;
    const unsigned char *view;
    size_t size;
} ShmView;

static int shm_close(lua_State *L) {
    ShmView *s = (ShmView *)luaL_checkudata(L, 1, SHM_MT);
    if (s->view) {
        UnmapViewOfFile(s->view);
        s->view = NULL;
    }
    if (s->hMap) {
        CloseHandle(s->hMap);
        s->hMap = NULL;
    }
    return 0;
}

static int shm_read(lua_State *L) {
    ShmView *s = (ShmView *)luaL_checkudata(L, 1, SHM_MT);
    luaL_argcheck(L, s->view != NULL, 1, "shared memory view is closed");

    lua_Integer offset = luaL_optinteger(L, 2, 0);
    lua_Integer len    = luaL_optinteger(L, 3, (lua_Integer)s->size - offset);

    if (offset < 0 || len < 0 || (size_t)(offset + len) > s->size) {
        return luaL_error(L, "read range out of bounds (size=%d)", (int)s->size);
    }
    lua_pushlstring(L, (const char *)(s->view + offset), (size_t)len);
    return 1;
}

/* Raw byte seqlock reader (returns Lua string + committed sequence) */
static int shm_read_seqlock(lua_State *L) {
    ShmView *s = (ShmView *)luaL_checkudata(L, 1, SHM_MT);
    luaL_argcheck(L, s->view != NULL, 1, "shared memory view is closed");

    lua_Integer offset     = luaL_optinteger(L, 2, 0);
    lua_Integer len        = luaL_optinteger(L, 3, (lua_Integer)s->size - offset);
    lua_Integer seq_offset = luaL_optinteger(L, 4, 0);
    lua_Integer max_spins  = luaL_optinteger(L, 5, 1000);

    if (offset < 0 || len <= 0 || len > MAX_STACK_BUF || (size_t)(offset + len) > s->size) {
        return luaL_error(L, "invalid read range (max=%d, size=%d)", MAX_STACK_BUF, (int)s->size);
    }
    if (seq_offset < 0 || (size_t)(seq_offset + sizeof(uint32_t)) > s->size) {
        return luaL_error(L, "sequence counter offset out of bounds");
    }

    unsigned char snap[MAX_STACK_BUF];
    const volatile uint32_t *seq_ptr = (const volatile uint32_t *)(s->view + seq_offset);

    for (lua_Integer attempt = 0; attempt < max_spins; attempt++) {
        uint32_t s1 = *seq_ptr;
        MemoryBarrier();

        if ((s1 & 1u) != 0u) {
            YieldProcessor();
            continue;
        }

        memcpy(snap, s->view + offset, (size_t)len);
        MemoryBarrier();
        uint32_t s2 = *seq_ptr;

        if (s1 == s2) {
            lua_pushlstring(L, (const char *)snap, (size_t)len);
            lua_pushinteger(L, (lua_Integer)s2);
            return 2;
        }
        YieldProcessor();
    }

    lua_pushnil(L);
    lua_pushliteral(L, "seqlock contention timeout");
    return 2;
}

/* Zero-allocation seqlock unpacker: pushes 16 native numbers directly onto the Lua stack */
static int shm_read_frame_seqlock(lua_State *L) {
    ShmView *s = (ShmView *)luaL_checkudata(L, 1, SHM_MT);
    luaL_argcheck(L, s->view != NULL, 1, "shared memory view is closed");

    lua_Integer offset    = luaL_optinteger(L, 2, 0);
    lua_Integer max_spins = luaL_optinteger(L, 3, 1000);

    if (offset < 0 || (size_t)offset + sizeof(FNTelemetryFrame) > s->size) {
        return luaL_error(L, "frame read out of bounds (need %d bytes, size=%d)",
                          (int)sizeof(FNTelemetryFrame), (int)s->size);
    }

    const unsigned char *base = s->view + offset;
    const volatile uint32_t *seq_ptr = (const volatile uint32_t *)base;
    FNTelemetryFrame frame;

    for (lua_Integer attempt = 0; attempt < max_spins; attempt++) {
        uint32_t s1 = *seq_ptr;
        MemoryBarrier();

        if ((s1 & 1u) != 0u) {
            YieldProcessor();
            continue;
        }

        memcpy(&frame, base, sizeof(FNTelemetryFrame));
        MemoryBarrier();
        uint32_t s2 = *seq_ptr;

        if (s1 == s2) {
            luaL_checkstack(L, 18, "insufficient Lua stack for telemetry frame");
            lua_pushinteger(L, (lua_Integer)s2);
            lua_pushinteger(L, (lua_Integer)frame.magic);
            lua_pushinteger(L, (lua_Integer)frame.tick);
            lua_pushinteger(L, (lua_Integer)frame.wheels_touching);

            lua_pushnumber(L, (lua_Number)frame.car_pos[0]);
            lua_pushnumber(L, (lua_Number)frame.car_pos[1]);
            lua_pushnumber(L, (lua_Number)frame.car_pos[2]);

            lua_pushnumber(L, (lua_Number)frame.car_vel[0]);
            lua_pushnumber(L, (lua_Number)frame.car_vel[1]);
            lua_pushnumber(L, (lua_Number)frame.car_vel[2]);

            lua_pushnumber(L, (lua_Number)frame.ball_pos[0]);
            lua_pushnumber(L, (lua_Number)frame.ball_pos[1]);
            lua_pushnumber(L, (lua_Number)frame.ball_pos[2]);

            lua_pushnumber(L, (lua_Number)frame.ball_vel[0]);
            lua_pushnumber(L, (lua_Number)frame.ball_vel[1]);
            lua_pushnumber(L, (lua_Number)frame.ball_vel[2]);
            return 16;
        }
        YieldProcessor();
    }

    lua_pushnil(L);
    lua_pushliteral(L, "seqlock contention timeout");
    return 2;
}

static int shm_open(lua_State *L) {
    const char *name = luaL_checkstring(L, 1);
    size_t size      = (size_t)luaL_checkinteger(L, 2);

    HANDLE hMap = OpenFileMappingA(FILE_MAP_READ, FALSE, name);
    if (!hMap) {
        return luaL_error(L, "OpenFileMappingA failed for '%s' (err=%d)", name, (int)GetLastError());
    }

    const unsigned char *view = (const unsigned char *)MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, size);
    if (!view) {
        int err = (int)GetLastError();
        CloseHandle(hMap);
        return luaL_error(L, "MapViewOfFile failed (err=%d)", err);
    }

    ShmView *s = (ShmView *)lua_newuserdatauv(L, sizeof(ShmView), 0);
    s->hMap = hMap;
    s->view = view;
    s->size = size;

    luaL_getmetatable(L, SHM_MT);
    lua_setmetatable(L, -2);
    return 1;
}

static int shm_read_once(lua_State *L) {
    const char *name   = luaL_checkstring(L, 1);
    size_t size        = (size_t)luaL_checkinteger(L, 2);
    lua_Integer offset = luaL_optinteger(L, 3, 0);
    lua_Integer len    = luaL_optinteger(L, 4, (lua_Integer)size - offset);

    if (offset < 0 || len < 0 || (size_t)(offset + len) > size) {
        return luaL_error(L, "read range out of bounds");
    }

    HANDLE hMap = OpenFileMappingA(FILE_MAP_READ, FALSE, name);
    if (!hMap) {
        return luaL_error(L, "OpenFileMappingA failed (err=%d)", (int)GetLastError());
    }

    const unsigned char *view = (const unsigned char *)MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, size);
    if (!view) {
        int err = (int)GetLastError();
        CloseHandle(hMap);
        return luaL_error(L, "MapViewOfFile failed (err=%d)", err);
    }

    lua_pushlstring(L, (const char *)(view + offset), (size_t)len);
    UnmapViewOfFile(view);
    CloseHandle(hMap);
    return 1;
}

__declspec(dllexport) int luaopen_fn_shm(lua_State *L) {
    if (luaL_newmetatable(L, SHM_MT)) {
        lua_pushcfunction(L, shm_close);
        lua_setfield(L, -2, "__gc");
        lua_pushcfunction(L, shm_close);
        lua_setfield(L, -2, "__close");

        lua_newtable(L);
        lua_pushcfunction(L, shm_read);
        lua_setfield(L, -2, "read");
        lua_pushcfunction(L, shm_read_seqlock);
        lua_setfield(L, -2, "read_seqlock");
        lua_pushcfunction(L, shm_read_frame_seqlock);
        lua_setfield(L, -2, "read_frame_seqlock");
        lua_pushcfunction(L, shm_close);
        lua_setfield(L, -2, "close");
        lua_setfield(L, -2, "__index");
    }
    lua_pop(L, 1);

    luaL_Reg funcs[] = {
        {"open",      shm_open},
        {"read_once", shm_read_once},
        {NULL,        NULL}
    };
    luaL_newlib(L, funcs);
    return 1;
}