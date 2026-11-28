# 方块世界 · 公网中继

让「跨网络联机」变成可能的最小方案：**一台服务器转发消息，谁都不用开端口、不用公网 IP。**

- 零依赖：只用 Node 内置模块，没有 `npm install`
- 零数据库：房间和方块改动全在内存里，进程重启就清空
- 兼容原包协议：`w / j / l / st / blk / mb / hit / hurt / bye` 原样不动

---

## 一、它是怎么工作的

```
玩家A ──wss──┐
             ├─→ 中继（本目录 server.js）─→ 按房间码转发
玩家B ──wss──┘
```

中继只做四件事：

| 职责 | 说明 |
| --- | --- |
| 分房间 | 连接地址带房间码 `/room/ABC123`，不同房间互相看不见 |
| 转发消息 | 位置、怪物、打怪、受伤、方块改动，谁发的就带上谁的 `from` |
| 存方块改动 | 后进房间的人能收到别人放过的方块，最多每房 4 万块 |
| 管房主 | 房主掉线留 20 秒宽限，凭密钥可以认回来；长期不回就自动换房主 |

游戏逻辑（地形、物理、怪物 AI）**全在浏览器里跑**，中继不参与计算，所以一台小机器就能撑住几十个房间。

---

## 二、本地试跑

```bash
cd relay
./run.sh            # Windows 用 run.bat
# 或者：node server.js 8787
```

然后打开 `http://127.0.0.1:8787/`，能看到当前房间列表；游戏本体顺手挂在 `http://127.0.0.1:8787/game/`，一个进程就把「开服 + 开网页」都包了。

游戏里这么填：

| 位置 | 填写 |
| --- | --- |
| 中继 | `ws://127.0.0.1:8787` |
| 创建房间 | 点一下，会生成 6 位房间码 |
| 加入房间 | 填对方给的房间码 |

同一台机器测试时，把邀请链接复制到另一个浏览器（或隐身窗口）打开就行。

---

## 三、放到公网

中继是普通 HTTP 服务，**必须套一层 HTTPS 反向代理**才能让 `https://` 页面连上（浏览器不允许安全页面连 `ws://`）。

### 方案 A：有域名 + 服务器（最稳）

用 Caddy 最简单，一行配置自动签证书：

```
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Nginx 的话是这样：

```nginx
server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

游戏里填 `wss://relay.example.com` 即可。

后台跑起来：

```bash
nohup node server.js 8787 > relay.log 2>&1 &
```

想开机自启就写个 systemd 服务，`ExecStart=/usr/bin/node /path/to/relay/server.js 8787`，`Restart=always`。

### 方案 B：临时给朋友玩（Cloudflare Tunnel）

本机不用开端口、不用买域名：

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

它会打印一个 `https://xxx.trycloudflare.com` 地址，把它换成 `wss://xxx.trycloudflare.com` 填进游戏就能用。地址是临时的，隧道一关就失效。

### 方案 C：平台的 Node 服务

任何能跑 Node 的平台都行（Railway、Render、Fly.io、自己的 VPS…），把本目录传上去，`PORT` 一般平台会自己注入，监听 `0.0.0.0`，然后把平台给的域名填进游戏。

> ⚠️ 免费平台常会闲置休眠，房间数据在内存里，一休眠房间就没了。玩的时候注意别放太久。

---

## 四、配置项

改 `server.js` 顶部的 `配置` 对象，或者用环境变量：

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | 8787 | 监听端口（也可以用第一个命令行参数） |
| `HOST` | 0.0.0.0 | 监听地址 |
| `RELAY_DEBUG` | 空 | 设为任意值会打印每一帧，排查用 |

代码里可调的限额：

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 每房人数上限 | 12 | 一房最多几个人 |
| 房间数上限 | 200 | 全服最多几个房间 |
| 单房方块改动上限 | 40000 | 超过就不记新的了，防内存爆 |
| 房主断线宽限 | 20 秒 | 房主掉线后多久内可以认回 |
| 空房保留 | 60 秒 | 没人了留一分钟，方便刷新回来 |
| 单连接消息上限 | 1800/分钟 | 位置包每 100ms 一个约 600/分钟，超标就丢包 |

---

## 五、接口

| 路径 | 用途 |
| --- | --- |
| `GET /` | 状态页，列出房间、人数、方块改动数 |
| `GET /healthz` | JSON 健康检查，给监控用 |
| `GET /status.json` | 同上，换个名字 |
| `GET /game/` | 游戏本体（就是 `sandbox/` 的静态站） |
| `WS /room/<房间码>` | 游戏连接，房间码 4~12 位字母数字 |

进房后第一条消息必须是握手包：

```json
{ "t": "hi", "name": "昵称", "host": 1, "key": "房主密钥" }
```

- `host` 为真且房间没房主 → 认领，并把 `key` 记成这个房间的房主密钥
- 房间已有房主 → 只有带着**相同密钥**才能认回（房主掉线重连的情况）
- 普通加入 → `host: 0`，`key` 留空

中继会回 `{ "t": "w", ... }` 欢迎包，然后开始转发。

出错时回 `{ "t": "err", "code": "...", "msg": "人话解释" }`，`code` 可能是 `hosted`（房间已有房主）、`badkey`（密钥不对）、`rate`（发言太快）。

---

## 六、自测

```bash
npm install ws --no-save    # 只有自测脚本需要，服务本身不需要
node server.js 8788 &
node 自测.mjs 8788
```

覆盖 23 项：握手、欢迎包内容、玩家列表、位置转发、方块同步、历史改动、房间隔离、抢房拦截、房主断线宽限与认回、离房通知、非法房间码。

---

## 七、已知边界

- **房间不持久**：重启即清空，没做落盘。想留存得自己接 Redis，但那就不叫轻量了
- **一切靠房间码**：房间码就是通行证，知道码就能进。别把房间码发到公开群
- **没有鉴权**：不登录、不要账号。防刷靠的是限额，不是身份
- **没有加密内容**：走 wss 时链路是加密的，但中继自己能看见消息内容（它要转发）
- **不碰 supabase**：这个项目不接任何外部数据库，符合「为了联机动我 supabase」的禁令
