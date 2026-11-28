# 方块世界 · Cloudflare Pages 公网中继（线上这份）

线上中继 `wss://game.fesui.xn--0iv.gay` 由这个 Pages 项目提供。

## 为什么用 Pages 而不是 Worker

`是.gay` 是免费二级域名，NS 不能改，CF 的 zone 处于 partial 状态。
给 **Worker** 绑自定义域时，CF 会写一条 `AAAA 100:: proxied` 的只读记录，
但自定义域验证要求 CNAME 在 CF 自己 DNS 里可见——外部注册商的 CNAME 读不到，
证书就永远卡在 `pending`，浏览器 TLS 握手直接失败。

**Pages** 项目走另一套验证：HTTP 校验 + 外部 CNAME 即可。实测 `api.fesui.是.gay`
绑在 `fkd-proxy` Pages 项目上能通，所以中继照搬这套。

## 结构

```
relay-pages/
  functions/[[path]].js   Pages Function：路由 /room/<码> 到 Durable Object
  public/index.html       占位首页
  wrangler.toml           DO 绑定到已有 Worker fesui-block-world-relay
```

Durable Object 类仍定义在 `relay-worker/src/index.js`，由 Worker
`fesui-block-world-relay` 承载；Pages 只做路由转发。两份代码协议完全一致。

## 部署

```bash
cd sandbox/relay-pages
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages deploy public --project-name=block-world-relay-pages
```

拿到 `*.pages.dev` 地址后，在 Pages 项目 → 自定义域里加 `game.fesui.是.gay`，
并在域名面板把 `game.fesui.是.gay` CNAME 到那个 `*.pages.dev` 地址。
CF 验证通过后会自动签 Lets Encrypt 证书。
