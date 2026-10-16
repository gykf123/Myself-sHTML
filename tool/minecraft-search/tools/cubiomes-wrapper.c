/* ==========================================================================
   wrapper.c — 开源 cubiomes 的等价适配层
   --------------------------------------------------------------------------
   目的：让「开源构建」与站点使用的构建导出同一套 API，
        使前端 Worker 可以无差别切换内核。

   上游：https://github.com/Cubitect/cubiomes （MIT License, Cubitect 等）
   导出契约与站点构建保持一致的语义：
     init_generator(mcVersion, flags) / apply_seed(seed:int64, dimension)
     generate_biome_range_at_y(scale, x, y, z, sx, sz)
     get_biome_data_pointer/size, get_biome_name
     find_structures_in_area(type, x0, z0, x1, z1, limit, checkTerrain)
     get_structure_results_count/pointer, get_spawn, get_spawn_result_pointer
     get_range_scale/sx/sz/x/z
   ========================================================================== */
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>
#include <emscripten.h>

#include "generator.h"
#include "finders.h"
#include "biomes.h"
#include "util.h"

static Generator g;
static int   g_mc = 0;
static int   g_dim = 0;
static uint64_t g_seed = 0;
static int   g_ready = 0;

static int *biomeBuf = NULL;
static int  biomeCap = 0;
static int  biomeSize = 0;
static int  r_scale = 4, r_x = 0, r_z = 0, r_sx = 0, r_sz = 0;

#define MAX_PTS 20000
static Pos *structBuf = NULL;
static int  structCount = 0;
static int  spawnRes[4] = {0, 0, 0, 0};

/* ----------------------------------------------------------- 生成器控制 */
EMSCRIPTEN_KEEPALIVE
void init_generator(int mc, int flags)
{
    g_mc = mc;
    setupGenerator(&g, mc, (uint32_t)flags);
    g_ready = 1;
}

EMSCRIPTEN_KEEPALIVE
int apply_seed(uint64_t seed, int dim)
{
    if (!g_ready)
        setupGenerator(&g, g_mc, 0);
    g_seed = seed;
    g_dim = dim;
    applySeed(&g, dim, seed);
    return 0;
}

/* --------------------------------------------------------------- 群系网格 */
EMSCRIPTEN_KEEPALIVE
int generate_biome_range_at_y(int scale, int x, int y, int z, int sx, int sz)
{
    if (!g_ready || sx <= 0 || sz <= 0 || sx > 4096 || sz > 4096)
        return -1;
    if (scale != 1 && scale != 4 && scale != 16 && scale != 64)
        scale = 4;
    int need = sx * sz;
    if (need > biomeCap) {
        int *nb = (int *)realloc(biomeBuf, (size_t)need * sizeof(int));
        if (!nb) return -1;
        biomeBuf = nb;
        biomeCap = need;
    }
    for (int j = 0; j < sz; j++) {
        for (int i = 0; i < sx; i++) {
            /* 该构建的语义：scale 是「步长因子」，x/z 的单位是 (scale/4) 个方块，
               采样精度固定为 1:4（与站点构建一致，已逐点对照验证）。 */
            int unit = (scale >= 4) ? (scale / 4) : 1;
            int bx = (x + i) * unit;
            int bz = (z + j) * unit;
            int id = getBiomeAt(&g, 4, bx, y, bz);
            biomeBuf[j * sx + i] = id;
        }
    }
    biomeSize = need;
    r_scale = scale; r_x = x; r_z = z; r_sx = sx; r_sz = sz;
    return 0;
}

EMSCRIPTEN_KEEPALIVE
int get_biome_data_pointer(void) { return (int)(intptr_t)biomeBuf; }

EMSCRIPTEN_KEEPALIVE
int get_biome_data_size(void) { return biomeSize; }

EMSCRIPTEN_KEEPALIVE
const char *get_biome_name(int id) { return biome2str(g_mc, id); }

EMSCRIPTEN_KEEPALIVE
int get_range_scale(void) { return r_scale; }
EMSCRIPTEN_KEEPALIVE
int get_range_sx(void) { return r_sx; }
EMSCRIPTEN_KEEPALIVE
int get_range_sz(void) { return r_sz; }
EMSCRIPTEN_KEEPALIVE
int get_range_x(void) { return r_x; }
EMSCRIPTEN_KEEPALIVE
int get_range_z(void) { return r_z; }

/* ------------------------------------------------------------ 结构查找 */
EMSCRIPTEN_KEEPALIVE
int find_structures_in_area(int type, int x0, int z0, int x1, int z1,
                            int limit, int checkTerrain)
{
    if (!g_ready) return 0;
    if (limit <= 0 || limit > MAX_PTS) limit = MAX_PTS;
    if (!structBuf) structBuf = (Pos *)malloc(sizeof(Pos) * MAX_PTS);
    if (!structBuf) return 0;
    structCount = 0;

    StructureConfig sconf;
    if (!getStructureConfig(type, g_mc, &sconf))
        return 0;
    int regChunks = sconf.chunkRange;
    if (regChunks <= 0) regChunks = 1;
    int blockReg = regChunks * 16;

    /* 归一化范围 */
    if (x1 < x0) { int t = x0; x0 = x1; x1 = t; }
    if (z1 < z0) { int t = z0; z0 = z1; z1 = t; }

    int rx0 = (int)floor((double)x0 / blockReg) - 1;
    int rz0 = (int)floor((double)z0 / blockReg) - 1;
    int rx1 = (int)floor((double)x1 / blockReg) + 1;
    int rz1 = (int)floor((double)z1 / blockReg) + 1;

    for (int rz = rz0; rz <= rz1 && structCount < limit; rz++) {
        for (int rx = rx0; rx <= rx1 && structCount < limit; rx++) {
            Pos p;
            if (!getStructurePos(type, g_mc, g_seed, rx, rz, &p))
                continue;
            if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1)
                continue;
            if (checkTerrain) {
                uint32_t flags = 0;
                if (!isViableStructurePos(type, &g, p.x, p.z, flags))
                    continue;
            }
            structBuf[structCount++] = p;
        }
    }
    return structCount;
}

EMSCRIPTEN_KEEPALIVE
int get_structure_results_count(void) { return structCount; }

EMSCRIPTEN_KEEPALIVE
int get_structure_results_pointer(void) { return (int)(intptr_t)structBuf; }

/* --------------------------------------------------------------- 出生点 */
EMSCRIPTEN_KEEPALIVE
int get_spawn(void)
{
    if (!g_ready) return 0;
    Pos s = getSpawn(&g);
    spawnRes[0] = s.x;
    spawnRes[1] = s.z;
    spawnRes[2] = 0;
    spawnRes[3] = 0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int get_spawn_result_pointer(void) { return (int)(intptr_t)spawnRes; }
