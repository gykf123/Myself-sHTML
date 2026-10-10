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

## 歧义与默认值
- 仓库名含 `'` 在 GitHub 不合法 → 取连字符形式 `Myself-sHTML`（探测命中）。
- `/workspace` 既有文件（`github_access_setup.sh`、`.codebuddy`）非本任务文件 → 保留不删、不提交，仅 add 任务文件。

## 冲突记录（REMIND vs 任务提示词）
- 既有 REMIND.md 含明文 SSH 公钥（为方便复制展示）；任务提示词要求「不得提交 SSH 公钥」。→ 按任务提示词执行：提交前移除明文公钥，冲突点在此记录。
- 既有 REMIND.md 无「决策记录/歧义与默认值/冲突记录/TODO/重大问题」固定区块；任务要求追加该结构。→ 保留原有 0–3 节核心内容，末尾追加固定区块（追加而非覆盖）。

## TODO / 待补充锚点
- 头像：`index.html` 头像位为占位容器，待用户补充 `<img src="./avatar.jpg">`。
- 项目导航：4 张占位卡片，统一标注「待补充」，待用户补充真实项目。
- 工具箱：「矿石查找器」已接 `./tools/ore-finder.html`（独立页面、新标签打开），逆向来源已去除。
- 个人格言：已写入 3 句，可改 `script.js` 的 `CONFIG.mottos`。
- GitHub Pages 部署：需确认仓库 `Settings → Pages` 源分支 = `main`、目录 = `/`(root)；预期访问 `https://gykf123.github.io/Myself-sHTML/`。

## 重大问题
- 无（本次未触发任何重大问题；凭据未泄露、无 force push、无无关文件改动）。
