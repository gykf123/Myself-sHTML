# Minecraft Search — 功能复刻版

对 [minecraftsearch.com](https://minecraftsearch.com) 的功能复刻：参考库 + 9 款工具，全部在浏览器本地运行，无后端、无追踪。

## 运行

```bash
node serve.mjs          # 默认 http://localhost:8080
node serve.mjs 3000     # 指定端口
```

> 必须通过 HTTP 访问（不能直接双击打开 HTML）：WASM 与 Web Worker 需要正确的 MIME 类型与来源，`serve.mjs` 已处理 `.wasm` 与跨源隔离头。

## 目录

```
├── serve.mjs                 零依赖本地服务器
├── index.html                首页
├── best-seeds.html           精选种子
├── tools/                    9 款工具
├── items/                    参考库（列表 / 详情）
├── assets/css/app.css        设计系统
├── assets/js/core.js         i18n、主题、布局、搜索、数据层
├── assets/js/seedmap/        种子地图引擎 + Worker
├── assets/data/*.json        参考库数据集（构建产物）
└── wasm/vendor | wasm/oss    两套世界生成内核
```

## 双内核

地图类工具（种子 / 矿石 / 结构 / 群系）的世界生成计算在 Web Worker 中进行，可切换两套内核：

| 内核 | 位置 | 说明 |
|---|---|---|
| A（vendor） | `wasm/vendor/` | 与源站一致的构建，覆盖 Java + 基岩版全部变体 |
| B（oss） | `wasm/oss/` | 由本仓库基于开源 cubiomes 自行编译（见下） |

两套内核导出同一套 API，因此 Worker 可无差别切换：

```
init_generator(mcVersion, flags)          apply_seed(seed, dimension)
generate_biome_range_at_y(scale,x,y,z,sx,sz)
get_biome_data_pointer/size, get_biome_name, get_range_*
find_structures_in_area(type,x0,z0,x1,z1,limit,checkTerrain)
get_structure_results_count/pointer, get_spawn, get_spawn_result_pointer
```

### 自行编译开源内核

`wasm/oss/` 由 `Cubitect/cubiomes`（MIT）编译而来，适配层见 `tools/cubiomes-wrapper.c`：

```bash
git clone https://github.com/Cubitect/cubiomes
emcc -O2 -o wasm/oss/cubiomes.js \
  generator.c biomenoise.c biomes.c finders.c layers.c noise.c quadbase.c util.c \
  ../tools/cubiomes-wrapper.c -I. \
  -sMODULARIZE=1 -sEXPORT_NAME=CubiomesModule \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web,worker
```

## 数据与算法来源

- 注册表数据（物品 / 方块 / 生物 / 群系 / 附魔 / 配方）：[PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data)（MIT），版本 1.21.11
- 中英文名称：Minecraft 官方语言文件（经 [misode/mcmeta](https://github.com/misode/mcmeta) 导出）
- 世界生成算法：[Cubitect/cubiomes](https://github.com/Cubitect/cubiomes)（MIT）
- 物品图标：minecraft.wiki / minecraft-api（远程加载，失败时自动降级为文字色块）

## 声明

技术复刻项目，用于学习与研究，非官方站点，与 Mojang / Microsoft 无关联。Minecraft 是 Mojang Studios 的商标。

## 功能覆盖

| 页面 | 说明 |
|---|---|
| `/` | 首页：Hero、全局搜索、9 张工具卡、参考库入口 |
| `/tools/` | 工具中心 |
| `/tools/seed-finder.html` | 按结构/群系条件搜索种子，结果可在地图验证 |
| `/tools/ore-finder.html` | 任意 Y 高度的地层分布 + 矿石生成规则表 |
| `/tools/structure-finder.html` | 22 类结构的区域扫描与坐标列表 |
| `/tools/biome-finder.html` | 95 个群系的连通块扫描与坐标 |
| `/tools/enchantment-planner.html` | 铁砧最优合并顺序（平衡树 vs 逐个合并） |
| `/tools/command-generator.html` | Java 组件语法 / Bedrock 语法的 `/give`、`/summon` |
| `/tools/crafting-calculator.html` | 配方递归展开、原材料清单、堆叠换算 |
| `/tools/text-studio.html` | 颜色代码 / 十六进制渐变 / 告示牌，5 种输出格式 |
| `/best-seeds.html` | 精选种子（含跳转到地图验证） |
| `/items/`、`/items/detail.html` | 参考库列表与详情（含合成配方还原） |

支持中英双语切换、明暗主题、全局搜索（物品 / 方块 / 生物 / 群系 / 附魔）。

## 两套内核的一致性

以 `seed=12345`、版本 1.21.4 在原点以东逐点对照群系网格：

- 采样点一致率 **11 / 12**（约 92%）
- 不一致点全部落在生物群系边界处，偏移 ≤ 1 格（4 方块）

差异来自站点构建相对上游 cubiomes 的版本微调；两套内核的群系 ID → 名称映射完全一致。

## 已知差异（相对源站）

- 界面语言仅中文 / 英文（源站 28 种）
- 未包含账号与赞助相关页面
- 物品图标依赖远程图床，离线时降级为文字色块
- 基岩版专属变体内核（`wasm/vendor/cubiomes_bedrock*` 等）已随仓库提供，但当前 UI 默认走 Java 版路径
