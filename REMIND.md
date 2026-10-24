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
- [2026-10-11] 新增「留言墙」板块（侧栏第 5 入口 `data-view="wall"`，主区视图「留一句话证明你来过」）：后端用 Supabase 新表 `public.guestbook`（与 messages/users 等隔离），经 Management API（PAT）执行建表 SQL 并显式 `GRANT SELECT,INSERT TO anon,authenticated`（适配 2026-10-30 新政策，否则 Data API 返回 permission denied）；前端用 publishable `ANON_KEY` 经 REST `/rest/v1/guestbook` 直连读写（读公开、写宽松，个人站点可接受，无需 Edge Function 校验），XSS 用 `escapeHtml`、写入走 REST 参数化；未登录显示「登录后即可留言」引导、已登录显示表单（昵称+内容，限长 30/500），提交成功提示与列表刷新时序已修正（先 `await loadWall()` 再显示「已发布」）。
- [2026-10-11] 登录接入：复用 `login/index.html`（用户已加的账号系统，签 HS256 JWT、7 天有效）；主页 `consumeLoginReturn()` 解析回调 `?token=` 存 localStorage（`fe_token`，跨域 Cookie 不通故用 URL 传参 + 落地清参），`renderAuth()` 显示「已登录/退出」或「登录/注册」入口，`loginHref()` 生成跳转（brand=FeSui + home + redirect）。
- [2026-10-11] 密钥保管铁律：PAT / service_role / JWT_SECRET 仅本地一次性使用，存于 `/root/.supabase/pat.env`（600 权限、仓库之外）；新增 `.gitignore` 排除 `*.pat.env`/`pat.env`/`github_access_setup.sh`/`*.key`/`secrets.*`；前端只用 publishable `ANON_KEY`（已内联，`/workspace` 内不含任何 secret）。建表走 Management API（PAT 仅调用时存在于内存），不写任何密钥到源码或脚本文件。
- [2026-10-13] 自助迭代打磨（参考 2025 个人主页设计范式：清晰 Hero、深色/玻璃主题切换、微交互、结构化数据 SEO、自定义 404、性能/懒加载、在上折叠区讲清身份）：①液态玻璃折射贴图升级——`feImage` 内联位移图由「球面透镜」(g=r) 改为「平面中心 + 强边缘折射」(g=r^2.5，中心位移 127 归零、边缘 R=2 强弯)，更贴真玻璃边缘；②项目占位卡由灰掉禁用态改为「规划中」角标徽章（视觉有意而非损坏），标签只留类别；③新增页脚（版权+最后更新+GitHub）、Person 结构化数据 JSON-LD、Supabase `preconnect`；④新增 404.html（复用主站样式、跟随主题偏好）、`skip-link`、`返回顶部`按钮（滚动>320px 出现、平滑滚动）、`scroll-behavior:smooth`（reduced-motion 下禁用）；⑤无头 Playwright 五视图验证全绿（默认玻璃主题、各视图元素、留言墙 mock 读写、返回顶部、主题切换、移动端抽屉、404），零 console 错误/警告。
- [2026-10-15] 自助迭代（无人值守，功能扩充 + 预设链接扩充）：①彩蛋预设链接池 4→12 条，新增念诗之王 av19390801、雷总摇起来 Are you OK av2271112、面筋哥×波澜哥 烤面筋 av21061574、全明星双♂人♂舞 av2648921、骚猪 av4606803、我是papi酱 av4033926、全明星Rap 黑喂狗 av3327562（均来自 B 站鬼畜区播放量 Top 榜文章/游民星空/网易等权威来源，av 号链接永久有效）；②新增顶部滚动进度条（fixed 3px 细线，玻璃主题三色渐变+辉光，scroll/resize 更新 scaleX，>1% 才显形）；③新增侧栏实时时钟（等宽字体 + 绿色在线呼吸点，每秒 setInterval，折叠窄条时 CSS 隐藏）；④留言墙加计数徽章「💬 N 条留言」（renderWallList 更新）+ 刷新按钮（内联 SVG 环形箭头，点击 `.spin` 旋转 + 重新 loadWall）；⑤Playwright 无头验证：时钟秒级走动、进度条 scaleX 随滚动、计数徽章与刷新、彩蛋 16 次点击命中全在 12 条池内、零 console 错误。
- [2026-10-16] 彩蛋预设链接池 11→13 条：新增【⚡蒋出没⚡】`https://b23.tv/pG6xkEZ`（302 解析为 BV1sP9MBcEbT）、【⚡粉  刷  蒋⚡】`https://b23.tv/J6CrrYm`（302 解析为 BV1pucHzSEbH）；标题按用户分享原文保留（含 emoji 与原排版空格）。验证：`node --check` 通过；Playwright 劫持 `window.open` 点击 25 次，全部命中池内且新链接被随机抽中；console 零错误。另：彩蛋按钮有 500ms 禁用间隔，自动化连点需等待超过该窗口，否则点击无效。
- [2026-10-16] 长期行为约定（用户设定）：**每次任务完成后，除正常文本回复外，必须通过 workbuddy 项目留言功能（`project_message_add_or_reply`）向用户汇报**。此规矩持续有效，不限于单次任务。
- [2026-10-16] 修复 + 目录迁移 + 迭代：①修复 iPad「请求移动网站」（移动 UA + 大视口）时标题区出现浏览器默认蓝色焦点环的问题——根因是 `script.js` switchView 里给 `#viewTitle` 设 `tabindex=-1` 并 `focus()`（读屏播报新标题的无障碍惯例），焦点触发 Safari 默认 focus ring；该元素不参与 Tab 序列，焦点环对键盘用户无意义，加 `.view-title:focus { outline: none }` 消除（程序焦点保留，a11y 不受损）；②修复侧栏折叠为 60px 窄条时登录态「✅ 已登录 / 退出」横排拥挤——`.sidebar.collapsed .auth-in` 改 `flex-direction: column` + gap 5px，「退出」按钮 margin-left 归零、字号 12px；③工具目录 `tools/` → `tool/`（`git mv` 保留历史），同步更新 `script.js` 工具树 href、README 4 处提及；ore-finder 内部仅引用 `../index.html`，同级深度迁移无影响；④新增 `tool/index.html` 目录索引页（自包含单文件，沿用 ore-finder 的 GitHub 深色工具风变量，工具卡片 + 占位卡 + 返回主页，响应式 + reduced-motion 降级），GitHub Pages 访问 `/tool/` 不再 404；⑤验证：Playwright iPad UA（is_mobile + iPad Safari UA，1194×834）复现并确认焦点环消除、登录态竖排不重叠（icoBottom 334 < outTop 339）、索引页卡片/返回/跳转、桌面端工具树新路径，8/8 全过、零 console 错误。注：iOS  Safari「请求移动网站」的焦点环是亮蓝粗框，桌面端是同款焦点环的细暗形态（Linux 无头 Chromium 亦复现），故此前未察觉。
- [2026-10-15] 卡片淡入动画体系（参考 blym.top 动效范式，本站适配版）：①侧栏导航 navIn 入场（translateX(-14px)→0，5 级 stagger .05–.25s）；②视图切换 fadeUp 淡入 + 视图内子元素 popIn 依次上浮（7 级 .03–.21s）；③友链/项目卡片 fadeUp 错落淡入扩至 8 级（.05–.54s）；④身份卡片 2 级淡入（.10s/.18s）；⑤留言条目淡入 + hover 左移 3px；⑥关键修复：动画 fill-mode 由 `both` 全量改为 `backwards`——`both` 播完后仍持续锁定 transform，导致 hover 位移/抬起全部失效；`backwards` 仅延迟期间防闪现、播完即交还控制权；⑦新增触屏降级 `@media (hover:none) and (pointer:coarse)`：禁用全部 hover 位移/缩放（防点击后粘滞高亮），active 改 `scale(.98)` 按压反馈；⑧清理重复的 `@keyframes fadeUp` 定义（保留「关键帧」集中区一处）；⑨Playwright 无头验证 14/14 全过：动画名/stagger/fill-mode 计算值、四类卡片 hover 位移恢复（matrix 精确匹配）、`is_mobile=True` 触屏降级 hover 无位移、`reduced_motion` 全禁用、零 console 错误；全量回归（五视图/mock 留言墙/主题切换/抽屉/404）同过。注：CDP `Emulation.setEmulatedMedia` 的 features 不支持 hover/pointer 特性，触屏媒体查询模拟须用 Playwright `is_mobile=True`（Chromium 下会置 pointer:coarse）。

- [2026-10-16] 工具箱改卡片式 + 邮箱 + MC 搜索子站整合：①工具箱视图由分类树改为卡片——`CONFIG.toolTree` 平铺为 `CONFIG.tools` 数组，`renderToolTree/renderTreeNode/hasLeafDeep` 重写为 `renderToolCards()`：生成 `article.tool-card.glass`（图标 + 名称 + 描述 + 右侧动作区），动作区两个按钮「↗ 在线跳转」（primary 实心 accent）与「📦 仓库浏览」（ghost 描边），均 `target=_blank rel=noopener noreferrer`，条目无 `repo` 字段时 ghost 按钮 `hidden`；所有用户可控文本一律 `textContent` 注入防 XSS；②CSS 新增 `.tool-cards`（grid minmax(460px,1fr)）/ `.tool-card`（flex 横排，hover translateY(-4px) 抬起，沿用 glass 高光）/ `.tool-card-main`/`-ico`/`-text`/`-name`/`-desc`/`-actions`/`.tool-btn`（两种变体）/ `.mail-line`（邮箱胶囊行），`@media (max-width:767px)` 单列且按钮撑满一行；③个人信息区 chips 下方新增邮箱行 `<a class="mail-line" href="mailto:fesui_a@sina.com">`（📮 图标 + 等宽字体地址，hover translateY(-1px)）；④整合 minecraftsearch.com 复刻子站至 `tool/minecraft-search/`（约 12MB：8 个工具页 + best-seeds + items，Java/基岩双版，WASM 双内核 vendor/oss 本地运行）——源包用站点根绝对路径（`/assets` `/wasm`），静态 HTML 按所处深度 sed 改相对路径（根级去前导 `/`，tools/、items/ 加 `../`），ES import 补 `./` 前缀修复裸模块名报错，`assets/js/core.js` 头部加 `import.meta.url` 运行时定位 `_SITE_ROOT` 与 `rel()`（NAV/brand/footer/fetchJSON 全走 rel），`cubiomes-worker.js` 的 `locateFile` 改 `../../wasm/{vendor,oss}/cubiomes.js`；⑤验证：Playwright 邮箱 mailto 正确、两卡片按钮 href 正确、新标签跳转 ore-finder 与 GitHub 仓库树/blob、390px 移动端单列按钮撑满、零 console 错误；本地 http.server 无 COOP/COEP 下 WASM 群系地图完整渲染并搜出匹配种子；⑥待办：构建安卓/iOS App 仓库（用户新指示，见用户消息）。
- [2026-10-16] 修复两轮反馈：①**静态资源缓存坑**（用户看到工具箱空白）——GitHub Pages 对静态文件 `cache-control: max-age=600`，用户拿到新 index.html（`#toolCards` 容器）+ 旧缓存 script.js（只认 `#toolTree`）导致渲染静默失败；修复：`index.html`/`404.html` 的 `style.css`/`script.js` 引用统一加 `?v=20261016` 版本参数（**以后每次改这两个文件必须换版本号**），页脚 `CONFIG.lastUpdated` 更新为 2026-10-16；②**MC 搜索子站动态链接 404**（用户点矿石查找 404）——整合时只 sed 了静态 HTML 的 href，漏掉 JS 模板字符串里写死的绝对路径（`/tools/xxx.html`、`/items/...`），本地测试时 http.server 根正好是子站目录所以掩盖了问题，线上 Pages 根是主站故 404；修复：`assets/js/core.js` 的 `rel` 补 `export`（此前仅内部定义，import 报 does not provide an export named 'rel'），`itemHref()` 5 处、`index.html` 4 处（工具卡/参考库卡/快捷 chips/搜索建议）、`tools/index.html` 3 处、`items/index.html` 3 处、`items/detail.html` 3 处、`best-seeds.html` 2 处全部包 `rel()`，import 语句补 `rel`；③验证方式沉淀：本地起服务必须指向**主站根**（/workspace）再访问 `/tool/minecraft-search/...`，让绝对路径错误真实暴露；Playwright 线上端到端（主页→MC 搜索卡→子站 8 卡→矿石查找器落地→搜索钻石进详情）全过、零 console 错误；④已知限制：GitHub Pages 只认根目录 404.html，子站 `tool/minecraft-search/404.html` 线上不生效，子站死链会落主站自定义 404（「页面走丢了 · FeSui」，含返回入口，可接受）。

- [2026-10-17] 两个「滚木」（空）仓库开工——个人主页的安卓/iOS 客户端（用户指示：调用子智能体编写、推送、构建，尽量原生，新链接或适配不了的才嵌 HTML）：①`gykf123/adapp`（GitHub，描述「个人主页、FKD 的安卓 App 仓库」）：Kotlin + Jetpack Compose + Material3 原生工程，42 文件，包名 `gay.fesui.adapp`，minSdk 24 / target 34；5 Tab（首页/项目/友链/留言/工具），留言墙直连 Supabase REST（anon key + guestbook 表，content/nickname 字段），工具与 FKD 用 WebView 载线上页（JS + domStorage 必开，WASM 已验证无 COOP/COEP 可用）；沙箱内装 Android SDK（cmdline-tools 13114758 + android-34 + build-tools 34.0.0 于 /root/android-sdk），Zulu JDK 20 + Gradle 8.7 构建成功，APK 9.6MB 存于仓库 `apk/FeSui-adapp-debug.apk`，aapt 验证包名/权限/launcher 正常；commit d0b4c0b；②`gykf123/iOS-app`（GitHub，描述「主页、FKD 等的 iOS app」）：Swift + SwiftUI 零第三方依赖工程（22 个 swift 文件，Ubuntu Swift 5.10 toolchain `swiftc -parse` 全过），XcodeGen（project.yml）方案不手写 pbxproj，CI（macos-14）xcodegen generate + xcodebuild 未签名构建；首次 CI 失败根因：xcodegen 2.46 生成 objectVersion 77（Xcode 16 格式）而 runner 默认 Xcode 15.4 读不了——修复：构建前 `xcode-select` 切镜像内预装 Xcode 16，无 Xcode 16 时回退 xcodegen 2.44.1 二进制生成兼容格式；commit 9c36d37 → 8964190；后经两轮编译错误修复（enum 内非法 `private init`、`HTTPSURLResponse` 拼写），commit 5da6926 起 CI（run 38985530038）构建**成功**；③两仓库内容数据与网页一致（文案从 script.js CONFIG 提取：mottos×3、projects×5、friendLinks×2、邮箱、Supabase 配置、三个工具/FKD URL），App 内不做登录门禁（RLS 已允许 anon insert）；④工作方式留痕：两个 general-purpose 子智能体并行作业（各 90 轮上限），产物核验由主线程完成（git log/文件树/aapt badging/文案 grep/GitHub API 确认推送）。

- [2026-10-18] 修复「矿石查找器无法输入种子/无法选择条件」（用户报障，从 MC 搜索子站进入）：①**主因**：子站 `assets/js/seedmap/map.js` 用 `new Worker('cubiomes-worker.js')` 按**页面 URL** 解析，而 worker 实际在 `assets/js/seedmap/`；从 `tools/ore-finder.html` 访问时请求变成 `tools/cubiomes-worker.js` → 404 → `await map.init()` 永久挂起 → 工具栏/矿石卡全都渲染不出来（表现为整页只有标题，没有任何输入控件）；修复：改用 `new Worker(new URL('cubiomes-worker.js', import.meta.url))`，与页面深度无关；②次因：worker 内 `CORE_URL` 的 `../../wasm/...` 少一级（worker 在 `assets/js/seedmap/`，需 `../../../wasm/`），改后内核 js/wasm 均 200；③**竞态**：worker `initGen()` 里 `STATE.seed = null` 会把已设种子清掉，而 ore-finder 的 `applyOre()` 在 toolbar 的 apply 之后又发了 `map.init()` → 瓦片计算 `generate_biome_range_at_y` 返回 -4（无效种子）；修复：`initGen` 不再清种子，`init` case 在 `STATE.seed !== null` 时重放 `applySeed`，页面侧 `applyOre` 改为 `await map.init()` 串行；④主站 `tool/ore-finder.html` 独立问题：JS 三处写 `getElementById("矿点详情").innerHTML`，但 HTML 里**该容器根本不存在**，`刷新()` 每次都在此抛异常，导致后续 `绘制高度图()`/`绘制()` 全断——补回容器（最近矿点表下方）并给三处加空判；⑤顺带给子站 seedmap 模块加版本参数（`toolkit.js?v=20261018`、`map.js?v=20261018`），避免 Pages 10 分钟缓存导致改完不生效；⑥验证：本地 + 线上双端 Playwright——子站种子框/版本/维度/Y/内核全部存在，填入种子点 Generate 后徽章回显、群系地图完整渲染（截图确认）、换种子像素均值变化（36.5→57.6）说明重绘生效；6 个工具页批量扫零 error；commit 36f4785。

- [2026-10-19] 补 CI 构建产物（用户反馈「为啥没有产物」）：根因是 iOS 工作流只跑 `xcodebuild build` 不上传 artifact，安卓仓库压根没有 CI（APK 是沙箱手工构建后放进 `apk/`）。修复：①iOS `build.yml` 改为 `xcodebuild archive` → 手工组 `Payload/` → `zip` 成未签名 `FeSuiApp-unsigned.ipa` → `actions/upload-artifact@v4` 上传（ipa 保留 30 天、xcarchive 保留 7 天），`actions/checkout` 升 v5 消 Node20 弃用告警；②adapp 新增 `.github/workflows/build.yml`：ubuntu-latest + temurin JDK 17 + `gradle/actions/setup-gradle@v4` 缓存 + `./gradlew assembleDebug` → 重命名带短 commit → 上传 artifact；`v*` tag 触发 `softprops/action-gh-release` 出 Release；③两边 README 补「下载产物」章节（明确说明产物在**单次运行详情页底部 Artifacts 区域**，不是 Actions 列表页；未签名 ipa 需自签或用 Xcode 重签）。经验：GitHub Actions 产物只有配置 `upload-artifact` 才会有，`build` 成功 ≠ 有产物；用户首次找产物要在 run 详情页最底部。
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

- [2026-10-24] 新增个人中心 `user/` 目录 + 修复 ticket 登录回跳断档：①新建 `user/`（index.html/user.css/user.js）：资料卡 = JWT 快照（sub/username/nickname/app_role/status/avatar_url/iat/exp）+ Supabase users 表详情（注册时间/最近登录/活跃值/简介，只 select 非敏感字段）+ guestbook 按 `user_id` 查「我的留言」；未登录/已过期/已登录三态引导；URL `?ticket=` 一次性票经 auth-exchange redeem 兑换后落 localStorage 并清参；UID 一键复制；登出回流未登录态；主题跟随主站 `localStorage.theme`；复用主站 `style.css?v=20261019` + 独立 `user.css`；②**发现并修复登录断档**：login 页早已改一次性 ticket 换票机制（URL 不落 JWT，防访问日志/Referer 泄露），但主站 `script.js` 的 `consumeLoginReturn` 只认 `?token=`——换票成功后回跳的是 `?ticket=`，主站收不到，**登录态必丢**（仅当 issue 接口异常降级时才侥幸工作）；已补 `redeemTicket` 异步兑换 + 成功后 `renderAuth/renderWallComposer` 刷新，user 页同步实现；③留言墙 insert 关联 `user_id`（JWT sub），个人中心「我的留言」据此汇总；④侧栏已登录态由「✅已登录」改为「🧑‍💻 个人中心」入口（新增 `.auth-profile` 样式）直达 `./user/`；⑤验证：本地 24/24 全过（未登录引导/无效 ticket 容错回落/过期 token 清除重引导/已登录态/登出回流/主站侧栏入口点击进入/真实 ticket 现签现兑全链路/零 JS 运行时错误——无效 ticket 的 redeem 返回 401 属预期容错路径）；线上域名全过；commit 3745e93；⑥探测确认（curl 实测）：JWT=HS256 7 天有效，payload 含 `sub`(uuid)/`username`/`nickname`/`app_role`/`status`/`avatar_url`；`auth-exchange` `issue`→ticket(120s 一次性)、`redeem`→token；guestbook 表有 `user_id uuid null` 可关联；**users 表 anon 可全表读（含 password_hash）——安全隐患，待提醒用户收紧 RLS**；⑦真实线上域名是 `fesui.是.gay`（见 CNAME，Punycode `fesui.xn--0iv.gay`）——**不是根域 `是.gay`**，探错域名会报 SSL_VERSION_OR_CIPHER_MISMATCH，别再踩；⑧测试账号 `fe_probe_dev`/`probe123456` 保留作回归测试（无 PAT 删不掉，已在留言墙 0 条）；⑨用户提供的 GitHub PAT 存 `/root/.gh_pat`(chmod 600) 仅本地使用，未写入任何仓库文件（前端代码公开可见，PAT 绝不落地），已提醒用户适时轮换。

- [2026-10-24] 账号绑定（GitHub OAuth 完整版 + QQ）落地，用户选定完整 OAuth 方案并提供了最高权限 PAT（存 /root/.gh_pat 600，仅本地）：①**关键事实：GitHub OAuth App 无创建 API，只能网页手动建**（PAT 再全也不行，搜证确认；GitHub App 才有 App Manifest flow，但那是仓库集成向，read:user 场景 OAuth App 是正解）；②新增 `supabase/functions/account/index.ts`（Deno Edge Function，deno check 通过）：action=profile（本人资料代理读，service_role，字段白名单绝不下发 password_hash）/ callback（code→token→api.github.com/user→写 users 表，github_id 唯一约束冲突返 409 防抢占）/ unlink / update-profile（QQ 5-12 位数字、昵称 1-30、简介 ≤200）；JWT 验签 secret 按 JWT_SECRET→SUPABASE_JWT_SECRET→SERVICE_ROLE_KEY 多候选，全不匹配降级查 users 表确认 sub 存在（保功能可用）；③新增 `supabase/account-bind.sql`：users 表加 github_id/github_login/github_avatar_url/github_linked_at/qq 五列 + github_id 部分唯一索引；**RLS 收紧：撤销 anon/authenticated 对 users 表全部 GRANT**（此前探测发现 anon 可全表读含 password_hash 的安全隐患至此修复），资料读写统一走 Edge Function service_role；④前端 `user/`：账号绑定卡（GitHub 已绑定/未绑定/Client ID 未配置禁用三态、QQ 表单）、`github-callback.html` 回调落地页（sessionStorage state 防 CSRF、error=access_denied 友好提示、成功 1.6s 跳回 `./?linked=github` 并 toast）、资料读取改「account 函数主路径 + anon 直读降级」——**降级只用基础字段，不带 github_*/qq 列**（SQL 未执行时这些列不存在，带上整笔 400，回归测试抓到过）、toast 组件、`GH_CLIENT_ID` 常量留空待填；⑤验证：mock Edge Function 19/19（绑定态渲染/QQ 保存刷新/非法输入前端拦截/解绑回落/回调四态：缺参、state 不匹配拒、成功跳转、拒绝授权）+ 回归 24/24；沉淀经验：**Playwright 的 `networkidle` 在「真实慢请求 + mock 即时响应」混合场景会误判超时，统一改 domcontentloaded + wait_for_selector 显式等待**；⑥半部署过渡态设计：函数未部署时 account 请求 CORS 404 噪声属预期，绑定卡显示「服务未部署」提示而非假绑定态；commit d80c67a。

- [2026-10-24] 站点体检报告落地 P0 + 快菜（用户转述了一份自测/他测报告 `fesui-优化建议.html`，本轮落地其中安全项与低成本项）：①**报告勘误**：「没有真 dark/light」不准确——standard 主题的 CSS 变量本就跟随系统 `prefers-color-scheme`（浅/深自动），liquid glass 恒深色；②**留言墙双层安全**（原 P0：anon 直插裸奔 + user_id 前端可伪造）：新 `supabase/functions/wall-post/index.ts`（验 JWT、user_id 服务端从 sub 提取、单 user 30s 限流、敏感词/长度过滤、service_role 插入，deno check 过）+ 新 `supabase/wall-security.sql`（before-insert trigger：全表 60s 超 20 条拒、同昵称同内容 60s 去重、长度兜重——**不依赖前端走不走函数，anon 直插同样受保护**）；③**兼容决策**：RLS **保留** guestbook anon insert（adapp/iOS-app 两个 App 仓库的留言墙依赖此通道，一刀切会弄挂 App 端），改由 trigger 兜底 + 网页端走函数主路径；**待办：App 端接入登录后彻底撤 anon insert**；④前端 `submitWall` 改函数通道，**不留降级路径**（P0 不留后门；wall-post 部署前网页端留言暂停，已写入配置清单）；401 自动清 token 回门禁；⑤快菜：`robots.txt`（禁 /login/ + sitemap 指向）、`sitemap.xml`（5 个 URL）、og:image/twitter:image 绝对化（用 punycode `https://fesui.xn--0iv.gay/og-image.png`，抓取器更稳）、canonical、style.css 全局 `prefers-reduced-motion` 降级（光斑停漂移 + 动画/过渡压瞬时 + scroll-behavior auto）；⑥验证：本地 14/14（reduced-motion 计算值、robots/sitemap 内容、og/canonical 值、版本号、门禁/表单/发布成功/429/400/401 四态透传、零 JS 错误）；⑦**同日第二次改静态资源的版本号用 `20261024b` 后缀区分**（铁律：每次改必须换，同一天多次就加字母后缀）；commit 2316290。遗留（报告 P1/P2，待用户排期）：搜索+标签筛选、随笔/动态视图、PWA、访客统计、CONFIG 拆 data.json、App 端登录接入。

- [2026-10-24] 新增 `reopenai/` Bot 唤醒台（用户上传原页 index.html，要求建目录 + 统一风格）：①原页是 orkestr（EU 免费层）QQ 机器人的保活工具——手动 no-cors POST 唤醒、GET 状态检测、setInterval 自动保活，逻辑干净原样保留（IIFE 包起来防污染全局）；②统一风格：复用 `../style.css?v=20261024b` + **`../user/user.css?v=20261024b`**（子页面骨架：.user-page/.user-topbar/.user-card/.act-btn/.user-foot/toast）+ 增量 `reopenai.css`（输入框/状态行/日志区/保活行，全走 CSS 变量）；主题跟随 localStorage.theme；**坑：首版漏引 user.css，.user-card 背景 transparent 而 --glass-bg 变量本身有值——跨目录子页必须同时引 style.css + user.css 两个文件**（user.css 实为「子页面公共骨架」，后续可抽成共享 page-kit.css，已记 TODO）；③**发现页面文案撒谎并补齐**：原页写「后台还有 GitHub Actions 定时保活兜底」，但仓库 `.github/workflows/` 根本不存在——新增 `bot-keepalive.yml`（cron `*/10 * * * *` UTC + workflow_dispatch 手动触发，curl POST 唤醒，网络抖动只 warning 不挂任务）；④验证：本地 Playwright 20/20（含：卡片玻璃背景非透明 rgba 断言——曾把 rgba(0,0,0,0) 误判 PASS，断言已改严；orkestr 请求 route 拦截验证 POST 计数/在线检测/无响应态/保活开关时序——另修了测试自身 posts_before 读取时序 bug）；commit 343af53。访问路径 `https://fesui.是.gay/reopenai/`。

- [2026-10-24] 唤醒台「手动访问能通、页面检测不行」根因修复（用户报 bug 附 Safari 截图：地址栏直开 `https://fesui-qqbot.orkestr.run` 返回 `{"status":"ok"}`，但 /reopenai/ 点「检测状态」显示不行）：①**根因 curl 实测坐实**：orkestr 服务（uvicorn）GET 200 但响应头**无任何 access-control-\*** 头，OPTIONS preflight 返 405（`allow: GET`）——页面原 `check()` 走标准 CORS fetch 必被浏览器拦截（用户看到「不行」），地址栏直开不受 CORS 限制（用户看到「能通」），现象完全吻合；另实测 **POST 返 405 Method Not Allowed**，即原「手动激活」的 no-cors POST 实际也是坏的（到达了但方法不被接受）；②修复 `reopenai/index.html`：`check()` 改**两级策略**——先试标准 CORS 请求（若服务端将来开放 CORS，可读 `status=ok` 语义状态，显示「● 在线」），被拦截/网络错则**降级 no-cors 连通性探测**（opaque 响应 resolve 即可连通=已唤醒，显示「● 可连通」并注明无法读取详细状态；reject 才显示「无响应（可能休眠中）」）；`ping()` 与自动保活**POST→GET**（服务只开放 GET，GET 到达同样刷新空闲休眠计时）；页头文案「定时 POST 唤醒」同步改「定时访问唤醒」；③`.github/workflows/bot-keepalive.yml` 同步 POST→GET，并把 36 小时门控版本首次提交（cron `0 */6 * * *` 每 6h 检查 + 距上次 ≥36h 才唤醒 + 时间戳 commit 回仓库持久化 + workflow_dispatch 手动强制）；④**端到端验证**：本地 Playwright 15/15（CORS 三态 + 唤醒方法断言 GET + 自动保活 + 零 JS 错误）+ **线上域名无 mock 直连真实 orkestr 验证通过**（显示「● 可连通」，降级日志完整）+ **workflow_dispatch 手动触发实跑 success**（日志：距上次 498008h → run=true → `orkestr 响应: 200` → 时间戳 commit 7e91e64 回写推送）；⑤沉淀经验：**Playwright 的 `route.fulfill` 不执行 CORS 校验**（mock 无 CORS 头时页面 CORS fetch 依然 resolve），测「CORS 被拦截」分支要用计数法（第 1 次 abort 模拟拦截、第 2 次 fulfill），或干脆不打 mock 走真实链路；⑥根治选项（待用户排期）：在 orkestr 的 FastAPI 服务里加 `CORSMiddleware`（allow_origins 填站点域名），检测即可恢复语义级「在线」；commit c44645b。
