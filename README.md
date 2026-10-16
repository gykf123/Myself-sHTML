# FeSui · 个人主页

> 极客 + Minecraft 玩家 的个人主页。纯静态、零依赖、零构建，通过 GitHub Pages 部署。

## 技术栈
- 原生 HTML + 外联 CSS + 外联 JS，无框架 / 无构建 / 无 CDN
- 全部相对路径，兼容 GitHub Pages 子路径部署
- 双主题（Standard / Liquid Glass），`localStorage` 记忆

## 目录结构
```
/
├── index.html            # 主页
├── style.css             # 样式（双主题，CSS 变量驱动）
├── script.js             # 交互（配置数据驱动的渲染）
├── tool/
│   └── ore-finder.html   # 基岩版矿物查找器（独立页面）
├── README.md
└── REMIND.md             # 关键事项与决策固化（内部维护）
```

## 访问地址
- 主页：`https://gykf123.github.io/Myself-sHTML/`
- 矿石查找器：`https://gykf123.github.io/Myself-sHTML/tool/ore-finder.html`

## 功能概览
- 左侧可折叠分类导航：**个人信息 / 项目导航 / 工具箱**
- 移动端抽屉式侧栏 + 遮罩层，响应式断点 ≥1200px / 768–1199px / ≤767px
- 双身份卡片：**FeSui**（极客人格）/ **不执拗的同学**（Minecraft 玩家）
- 个人格言（可自定义）
- 项目占位卡片（可补充真实项目）
- 工具箱树形导航：`我的世界 → 基岩版 → 矿石查找器`

## 矿石查找器
基岩版矿物分布预测工具：输入世界种子与版本，精确到方块坐标输出矿点分布。
- 独立页面 `tool/ore-finder.html`，自包含、无需联网、无需服务端
- 由主页工具箱树「矿石查找器」以新标签页打开
- 顶部「← FeSui 主页」可返回主页

## 如何自定义
| 想改什么 | 怎么做 |
|---|---|
| 头像 | 取消 `index.html` 中 `avatar-box` 内的注释，放入 `<img src="./avatar.jpg" alt="头像">` |
| 格言 | 改 `script.js` 的 `CONFIG.mottos` |
| 项目卡片 | 改 `CONFIG.projects`（每项 `name / desc / tags / href`） |
| 工具箱树 | 改 `CONFIG.toolTree`（嵌套 `children`；叶子用 `href` + `note`） |
| 主题 | 右上角 `◐` 切换，自动记忆 |

## 部署（GitHub Pages）
仓库 `Settings → Pages`：
- Source：`Deploy from a branch`
- Branch：`main`，目录 `/ (root)`
- 保存后约 1 分钟构建生效

## 本地预览
直接双击 `index.html` 即可（无需服务器）；矿石查找器同样直接打开 `tool/ore-finder.html`。
