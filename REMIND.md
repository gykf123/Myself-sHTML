# REMIND.md — 重要事项与工作要求固化

> 用途：跨会话、跨任务必须长期遵守的硬性要求与重要事项。每次开工前先读一遍本文件。

## 0. 最高优先级铁律（务必生效）

- **所有深度思考、内部对话，除代码与专有名词外，全部使用简体中文。**
- 此规则优先级最高，任何情况下不得被覆盖、不得退回英文思考。
- 例外仅限：代码本身、命令行、API 名称、技术专有名词（如 Git / GitHub / IP / DNS / HTTPS / TCP 等）可保留原文。

## 1. 语言与表达要求

- 默认思考与回复语言：简体中文。
- 用户用中文提问 → 全程中文；用户明确要求使用其他语言时 → 才切换。

## 2. GitHub 访问指南（已按 WorkBuddy 资料库《GITHUB_ACCESS_BREAKTHROUGH.md》落地）

> 资料库原文结论：**限制发生在 DNS 层，绕过本地 DNS + 走 SSH over 443 即可全通。**
> 配套一键脚本：`/workspace/github_access_setup.sh`（仅本地使用，不纳入本仓库提交）

### 2.1 本沙箱实测环境画像

- 出网正常（`baidu.com` 返回 200），但 GitHub **HTTPS 直连被阻断**：`curl/git` over https 卡 135 秒连不上。
- **唯一可用通道：SSH over 443**（`ssh.github.com:443`），已验证 `ssh -T git@github.com` 返回 `Hi gykf123! ... authenticated`。

### 2.2 已落地配置（持久化于本沙箱，不进仓库）

| 配置项 | 内容 |
|---|---|
| `/etc/hosts` + `~/.user_hosts` | github 各域名真实 IP |
| `~/.ssh/id_ed25519_github` | ed25519 密钥（已加入 GitHub 账户 gykf123） |
| `~/.ssh/config` | `Host github.com → HostName ssh.github.com, Port 443` |

> 本沙箱 SSH 公钥已添加至 GitHub，可正常推送；**公钥凭据不在此文件明文展示**（遵循 SSH 约束）。

### 2.3 关键坑位（务必记住）

- `/etc/hosts` 是只读 bind mount，禁用 `sed -i`；用 Python 重写或 `>>` 追加。
- 只追加不去重 = 旧错误条目生效；写入前先清理含 github 的旧行。
- 仅改 `/etc/hosts` 重启失效，必须同步 `~/.user_hosts`。
- HTTPS 通道被阻断，推送一律走 SSH。
- 真实 IP 可能变化，新会话重跑 `github_access_setup.sh` 重新解析。

## 3. 其他长期约定

- 涉及项目网盘（tdrive）/ 共享文件的写操作，必须先与用户确认。
- 涉及金融数据查询，优先 finance-data 插件能力。
- 最终交付文件统一放在 `/workspace`。

---

## 决策记录
- [2026-10-10] 目标仓库用户口语为 `Myself'sHTML`，经 `git ls-remote` 探测命中真实名为 `Myself-sHTML`（连字符、去除单引号，GitHub 不允许仓库名含 `'`），默认分支 `main`。
- [2026-10-10] `/workspace` 原非 git 仓库，已将 clone 的 `.git` 元数据复制进 `/workspace` 并整合 `README.md`，使其成为 `git@github.com:gykf123/Myself-sHTML.git` 的工作副本（remote 为 SSH over 443）。
- [2026-10-10] 按任务「不得提交 SSH 公钥」约束，自 REMIND.md 移除明文公钥；公钥仅存于本沙箱 `~/.ssh`，不进仓库。
- [2026-10-10] 仅精确 `git add` 四个任务文件（index.html / style.css / script.js / REMIND.md），未纳入 `github_access_setup.sh` 与 `.codebuddy`。
- [2026-10-10] 仓库无本地 git 身份，按无人值守取默认值：user.name=`gykf123`、user.email=`gykf123@users.noreply.github.com`（GitHub 无回复邮箱，commit 不泄露真实邮箱），仅 local 作用域。
- [2026-10-10] 矿石查找器（基岩版矿物查找器.html）作为独立子页面部署于 `tools/ore-finder.html`：自包含单文件（HTML/CSS/JS 全内联，不依赖 wasm/Python），由工具箱树「我的世界→基岩版→矿石查找器」以 `target="_blank"` 打开，**未内嵌**进主页。
- [2026-10-10] 集成时严格「去掉逆向来源」：`原站实现倒查报告.md`/`wasm直连测试结论.md`/`说明文档.md`/`注意事项与使用说明.md` 与 `wasm校验器/` 整目录、`bedrock_ore_core.py`/`template2.html`/`rules_inline2.js` 均未纳入部署；`ore-finder.html` 内"逻辑逆向自 minecraftsearch.com""原站""对拍原站 wasm"等字样与「与原站交叉验证」面板已清除（断言无 minecraftsearch/逆向/原站 残留）。
- [2026-10-10] 风格统一：矿石查找器顶部加「← FeSui 主页」返回链接（相对 `../index.html`，兼容子路径），与主站品牌/导航统一；保持独立深色工具风（与主站深色模式协调）。
- [2026-10-10] 项目导航新增「FKD 服务器主页」真实卡片：`href='https://FKD.是.gay'`、`target='_blank'`（外部站点新标签打开，加 `rel="noopener noreferrer"` 防反向标签页劫持）；中文 IDN 域名直接写入，浏览器原生支持、无需 Punycode。
- [2026-10-10] 首页个人信息区加 GitHub 主页入口：`href='https://github.com/gykf123'`（`gykf123` 由 SSH 认证 `Hi gykf123!` 确认）、`target='_blank'`、`rel="noopener noreferrer"`；GitHub mark 用内联 SVG（零外部依赖），样式 `.github-link` 复用主题变量（浅色/深色/液态玻璃均适配）。
- [2026-10-10] 测试 `fesui.是.gay` 连通性：DNS 解析命中 GitHub Pages IP（185.199.108.153），`curl https://fesui.xn--0iv.gay/` 返回 HTTP 200（1.26s），确认该域名已指向 GitHub Pages 且可正常访问；用户后续确认 Pages 已开启、域名即为此域名，用于线上部署验证。
- [2026-10-10] 侧边栏交互重构：按用户修正需求，侧栏从「accordion 折叠面板」改为「纯导航选择」——点击 `个人信息/项目导航/工具箱` 任一导航项 → 桌面端侧栏自动折叠为窄条、移动端关闭抽屉 → 主内容区切换对应视图并显示大标题（如「工具箱」）；原侧栏内的头像/身份/格言/项目卡片/工具树全部移入主区，由 JS 的 `switchView()` 驱动，localStorage 记忆当前视图。
- [2026-10-10] 液态玻璃增强：新增 `body.theme-glass::before` 流动光斑背景动画；`.glass` 类的主区表面（info-hero/about/identity-card/github-link 等）在 glass 主题下应用 `backdrop-filter: blur(14px)` + 半透明 + 高光边框 + 柔和内阴影；不支持 `backdrop-filter` 时降级为半透明纯色；已通过本地 headless Chromium 截图验证标准与 glass 两主题、info 与 proj 两视图均正常。
- [2026-10-10] 头像过大修复：用户上传头像为 1280×1280/200KB，在 iPad Safari 出现撑大现象；将图片裁剪缩放为 256×256/27KB，并在 `<img>` 标签加 `width="96" height="96" loading="lazy"`，CSS 加 `max-width/max-height` 兜底，防止浏览器忽略样式时图片爆开。
- [2026-10-10] 主题切换入口补强：用户反馈 topbar 的 `◐` 按钮在 iPad Safari 不易见/不可点；在侧栏头部（`.sidebar-head`）新增 `#sidebarThemeBtn` 主题切换按钮，与 topbar `#themeBtn` 共用 `applyTheme()`，两个入口任选其一。
- [2026-10-10] 彩蛋按钮：在「关于我」简介后加 `#eggBtn`（"来点惊喜"），点击后从 `CONFIG.eggLinks` 随机选一条链接在新标签打开；预设数组当前为空，空数组时按钮文字临时变为"预设链接待补充…"并自动恢复，后续在 `CONFIG.eggLinks` 里加 `{title,url}` 即可生效。
- [2026-10-10] 动画增强：视图内子元素 stagger 上浮入场（`.view:not([hidden]) > *`）、项目卡片 stagger、chip hover 微缩放、彩蛋按钮脉冲 + 骰子抖动；所有动画尊重 `prefers-reduced-motion: reduce`。
- [2026-10-10] 液态玻璃升级（从毛玻璃到真·液态玻璃）：参考 GitHub 开源实现 `arsalan06106/liquid-glass-html-css`，在 `index.html` 注入隐藏 SVG filter `#lg-distort`（`feTurbulence` + `feDisplacementMap`），glass 主题下 `.glass`/`.sidebar` 使用 `backdrop-filter: blur(12px) url(#lg-distort) saturate(160%)` 实现背景边缘折射扭曲；叠加 8 层 `inset box-shadow` 模拟顶部高光、边缘反射、内部阴影与投影；降级方案保留。
- [2026-10-10] 默认主题改为液态玻璃：`<body>` 开头内联脚本在无 localStorage 时默认添加 `theme-glass` 类，`script.js` 的 `bindTheme()` 默认值同步改为 `'glass'`，避免刷新闪烁；用户仍可点 `◐` 切回标准主题。
- [2026-10-10] 更多过渡动画：补齐工具箱树展开/收起的高度+透明度过渡、导航 active 左侧指示条平滑伸缩、身份卡片 hover 抬起与高光、头像 hover 缩放旋转、视图标题切换轻量滑入、移动端遮罩淡入淡出、彩蛋点击庆祝弹跳+骰子加速、主内容 `.content` 初始淡入；所有动画仍只用 `transform`/`opacity`/`max-height`，尊重 `prefers-reduced-motion: reduce`。
- [2026-10-11] 液态玻璃升级（折射贴图，方案A 简化版）：用预计算径向位移贴图（feImage 内联 base64，编码 g=r 使边缘弯曲最强）替代原随机 `feTurbulence` 噪声；glass 主题下 `.glass` 新增镜面高光伪元素（顶部亮线 + 边缘反射，screen 混合，不挡内容）；主题类从 `<body>` 前移至 `<head>` 操作 `<html>`（彻底防闪），CSS 全部 `body.theme-glass` 改为 `html.theme-glass`。
- [2026-10-11] 无障碍增强：新增 `prefers-reduced-transparency: reduce` 降级（关闭模糊、改用近不透明表面保对比度）；视图切换后焦点自动移到 `#viewTitle`（`tabindex="-1"`）并配 `aria-live="polite"` 播报；占位项目卡片（`href="#"`）加 `is-placeholder`+`aria-disabled` 并阻止默认跳转（不再跳页顶）。
- [2026-10-11] SEO/分享与资源：`<head>` 补 Open Graph + Twitter Card 元标签；新增 `favicon.png`（头像缩至 64×64）与 `og-image.png`（1200×630 深色渐变占位分享卡）；友链底部"发邮件给我"指向 `mailto:gykf123@users.noreply.github.com`。
- [2026-10-11] 跳过项（判断不在个人主页合理投入内）：WebGL/WebGPU 真折射（过度）、新购纯 ASCII 短域名（沙箱不可操作）、三级帧率探测降级（已由 reduced-motion + reduced-transparency 覆盖主要场景）。

## 冲突记录（REMIND vs 任务提示词）
- 原始任务提示词要求「左侧分类栏：三个一级分类，点击分类标题展开/收起子内容」，但用户后续明确修正为「左侧边栏只是一个选择，点了工具箱后侧边栏收起、主界面上方标题工具箱、不是所有全挤在侧边栏」。按 REMIND「若 REMIND 与本提示词冲突，自行按 REMIND 执行」的原则，这里用户实时指令即最高优先级，已按新需求重构；未删除/隐藏旧结构，而是重写为导航+主区视图。

## 歧义与默认值
- 仓库名含 `'` 在 GitHub 不合法 → 取连字符形式 `Myself-sHTML`（探测命中）。
- `/workspace` 既有文件（`github_access_setup.sh`、`.codebuddy`）非本任务文件 → 保留不删、不提交，仅 add 任务文件。

## 冲突记录（REMIND vs 任务提示词）
- 既有 REMIND.md 含明文 SSH 公钥（为方便复制展示）；任务提示词要求「不得提交 SSH 公钥」。→ 按任务提示词执行：提交前移除明文公钥，冲突点在此记录。
- 既有 REMIND.md 无「决策记录/歧义与默认值/冲突记录/TODO/重大问题」固定区块；任务要求追加该结构。→ 保留原有 0–3 节核心内容，末尾追加固定区块（追加而非覆盖）。

## TODO / 待补充锚点
- 头像：已完成。用户上传头像已保存为 `avatar.png`，`index.html` 已引用并推送；头像裁剪为 256×256/27KB，`<img>` 加 `width/height/loading` 与 CSS 兜底防止撑大。
- 项目导航：4 张占位卡片，统一标注「待补充」，待用户补充真实项目。
- 工具箱：「矿石查找器」已接 `./tools/ore-finder.html`（独立页面、新标签打开），逆向来源已去除。
- 个人格言：已写入 3 句，可改 `script.js` 的 `CONFIG.mottos`。
- GitHub Pages 部署：已启用，自定义域名为 `fesui.是.gay`（Punycode `fesui.xn--0iv.gay`），CNAME 文件已合并自远程；预期访问 `https://fesui.是.gay/` 与 `https://fesui.是.gay/tools/ore-finder.html`。

## 重大问题
- 无（本次未触发任何重大问题；凭据未泄露、无 force push、无无关文件改动）。
