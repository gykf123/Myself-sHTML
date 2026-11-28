# 方块世界 · Cloudflare Workers 公网中继

和 `../relay/server.js` 协议完全一致，只是把「一台常驻 Node 进程」换成
「Workers + Durable Objects」：**每个房间码对应一个独立 Durable Object**，
房间之间天然隔离，WebSocket 由 Cloudflare 边缘节点维持。

## 线上地址

| 项目 | 值 |
| --- | --- |
| 线上中继 | `wss://game.fesui.xn--0iv.gay`（Pages 项目 `relay-pages/` 提供） |
| 连接路径 | `/room/<房间码>` |
| 健康检查 | `https://game.fesui.xn--0iv.gay/healthz` |
| Worker 名 | `fesui-block-world-relay` |
| 状态页 | `https://game.fesui.xn--0iv.gay/` |

游戏页面里的「中继」输入框默认就是上面这个地址，玩家不用手填。

## 为什么「是.gay」能绑 Worker，却不能用 DNS 记录绑

`是.gay` 是别人提供的免费二级域名，**NS 不能改**，但本账号里的 zone 处于
「partial setup」状态：Cloudflare 只作为 CNAME 接入的前置层，靠 `100::`
这条 AAAA 记录（proxied）来接管流量。

Workers 的 Custom Domain 会自动写好这类记录，所以绑定只需要在
`wrangler.toml` 里加：

```toml
[[routes]]
pattern = "game.fesui.xn--0iv.gay"
custom_domain = true
```

再 `npx wrangler deploy` 即可，Cloudflare 会自己补上
`AAAA game.fesui → 100::  (proxied)`。**不要手动建 CNAME**，会跟 Custom Domain
打架，报 1014 之类的错。

## 部署

```bash
cd sandbox/relay-worker

# 一次性配好凭证
export CLOUDFLARE_API_TOKEN=你的token
export CLOUDFLARE_ACCOUNT_ID=你的账号ID

npx wrangler deploy
```

输出里会同时给出 `*.workers.dev` 地址和自定义域名。
（`workers.dev` 在国内常见网络下会被阻断，实际用自定义域名。）

想换域名，改 `wrangler.toml` 里的 `pattern` 再重新 deploy，然后在游戏页面把
「中继」输入框改成新地址；如果希望所有人默认用新地址，改
`game.js` 里的 `默认中继` 和 `index.html` 里 `#netRelay` 的 `value`。

## 协议

与 Node 版一致，兼容原包的 `w / j / l / st / blk / mb / hit / hurt / bye`，
新增 `host`（换房主）、`err`（人话报错）、`pong`（心跳回应）。

连接：`wss://<域名>/room/<房间码>?name=昵称`，房间码 4~12 位字母数字，自动转大写。

## 限额

| 项 | 值 |
| --- | --- |
| 每房人数 | 12 |
| 单房方块改动 | 40000 |
| 单条消息 | 64 KB |
| 单连接消息速率 | 1800 条/分钟 |
| 房主断线宽限 | 20 秒（凭密钥可认回） |
| 空房回收 | 60 秒后 Durable Object 自动休眠 |

## 数据在哪

房间成员、方块改动存在对应 Durable Object 的存储里，房间空了自动回收。
不接 supabase，不接任何外部数据库，也不写日志。
