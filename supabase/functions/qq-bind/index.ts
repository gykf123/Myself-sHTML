/** QQ 绑定码系统（edge function: qq-bind）
 *
 * 三个 action：
 *  - create   站点页调用（带用户 JWT）：生成 8 位绑定码，10 分钟有效
 *  - exchange 机器人调用（anon key + 绑定码）：校验并核销绑定码，换取 7 天用户 JWT
 *             并下发一次长期续签凭据 bind_secret（库里只存 sha256）
 *  - renew    机器人调用（anon key + bind_secret）：JWT 过期后换取新 7 天 JWT
 *
 * 安全模型：
 *  - JWT 签发/验签与 login 函数完全一致（HS256 + JWT_SECRET，claims 同款）
 *  - qq_bind_codes / qq_bind_secrets 表 RLS 开启且无 policy，只有 service_role（本函数）能读写
 *  - exchange 用「条件更新」原子核销，并发下只有一个请求能兑换成功
 *  - bind_secret 只在 exchange 返回一次，重绑即轮换（upsert 覆盖旧行）
 */ import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const JWT_SECRET = Deno.env.get("JWT_SECRET") ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store"
};
function json(b, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: {
      ...CORS,
      "Content-Type": "application/json"
    }
  });
}
// ---------------------------------------------------------------- 长期续签凭据
// sha256 十六进制：库里只存 hash，明文 secret 只在 exchange 返回一次
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// 32 字节随机数 → 43 字符 base64url（与下方 b64uEncode 同一套编码）
function newBindSecret() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64uEncode(b);
}
// ---------------------------------------------------------------- base64url
function b64uEncode(bytes) {
  let bin = "";
  for (const b of bytes)bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64uDecode(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++)bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// ---------------------------------------------------------------- JWT（与 login 同格式）
async function signJWT(payload, secret) {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const enc = new TextEncoder();
  const data = b64uEncode(enc.encode(JSON.stringify(header))) + "." + b64uEncode(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return data + "." + b64uEncode(new Uint8Array(sig));
}
// 用统一的 claims 结构签发 7 天 JWT（exchange / renew 共用，保证 RLS 判定一致）。
// 注意：这里刻意不用 npm:jose，而是复用上面的手签 signJWT，claims 与现有线上 token 逐字段一致。
async function signUserJwt(u) {
  const now = Math.floor(Date.now() / 1000);
  return await signJWT({
    sub: u.id,
    aud: "authenticated",
    role: "authenticated",
    username: u.username,
    nickname: u.nickname || null,
    app_role: u.role,
    status: u.status,
    avatar_url: u.avatar_url ?? null,
    iat: now,
    exp: now + 60 * 60 * 24 * 7
  }, JWT_SECRET);
}
async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
      name: "HMAC",
      hash: "SHA-256"
    }, false, [
      "verify"
    ]);
    const ok = await crypto.subtle.verify("HMAC", key, b64uDecode(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch  {
    return null;
  }
}
// ---------------------------------------------------------------- 绑定码生成
// 去掉易混淆字符（0/O、1/I/L 等），8 位
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genCode(len = 8) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b)=>CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
// ---------------------------------------------------------------- 主处理
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  if (req.method !== "POST") return json({
    ok: false,
    msg: "方法不允许"
  }, 405);
  let body;
  try {
    body = await req.json();
  } catch  {
    return json({
      ok: false,
      msg: "请求体不是 JSON"
    }, 400);
  }
  const action = String(body.action || "");
  // ---------- create：站点页调用（带用户 JWT），生成绑定码 ----------
  if (action === "create") {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({
      ok: false,
      msg: "未登录"
    }, 401);
    const payload = await verifyJWT(token, JWT_SECRET);
    if (!payload || !payload.sub) return json({
      ok: false,
      msg: "登录态无效，请重新登录"
    }, 401);
    const userId = String(payload.sub);
    const code = genCode();
    // 顺手清掉该用户名下已过期的码，避免堆积
    await supabase.from("qq_bind_codes").delete().eq("user_id", userId).lt("expires_at", new Date().toISOString());
    const { error } = await supabase.from("qq_bind_codes").insert({
      code,
      user_id: userId
    });
    if (error) return json({
      ok: false,
      msg: "生成失败：" + error.message
    }, 500);
    return json({
      ok: true,
      code,
      expires_in: 600
    });
  }
  // ---------- exchange：机器人调用（anon key + 绑定码） ----------
  if (action === "exchange") {
    const code = String(body.code || "").trim().toUpperCase();
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      return json({
        ok: false,
        msg: "绑定码格式不正确（8 位字母数字）"
      }, 400);
    }
    const { data: row, error: selErr } = await supabase.from("qq_bind_codes").select("code, user_id, expires_at, used_at").eq("code", code).maybeSingle();
    if (selErr) return json({
      ok: false,
      msg: "查询失败：" + selErr.message
    }, 500);
    if (!row) return json({
      ok: false,
      msg: "绑定码不存在，请去站点重新生成"
    }, 400);
    if (row.used_at) return json({
      ok: false,
      msg: "绑定码已被使用过，请重新生成"
    }, 400);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({
        ok: false,
        msg: "绑定码已过期（10 分钟有效），请重新生成"
      }, 400);
    }
    // 原子核销：条件更新 used_at，并发下只有一个请求能成功
    const { data: claimed } = await supabase.from("qq_bind_codes").update({
      used_at: new Date().toISOString()
    }).eq("code", code).is("used_at", null).select("code").maybeSingle();
    if (!claimed) return json({
      ok: false,
      msg: "绑定码刚被使用，请重新生成"
    }, 409);
    const { data: user, error: userErr } = await supabase.from("users").select("id, username, nickname, role, status, avatar_url, qq").eq("id", row.user_id).maybeSingle();
    if (userErr || !user) return json({
      ok: false,
      msg: "账号不存在"
    }, 400);
    // 签 7 天 JWT，claims 与 login 完全一致
    const token = await signUserJwt(user);
    // 下发长期续签凭据（重绑即轮换：upsert 覆盖旧行）。只存 sha256，明文只在这里返回一次。
    const bindSecret = newBindSecret();
    const { error: secretErr } = await supabase.from("qq_bind_secrets").upsert({
      user_id: user.id,
      secret_hash: await sha256Hex(bindSecret),
      created_at: new Date().toISOString(),
      last_used_at: null
    });
    if (secretErr) return json({
      ok: false,
      msg: "续签凭据保存失败：" + secretErr.message
    }, 500);
    return json({
      ok: true,
      token,
      user_id: user.id,
      username: user.username,
      nickname: user.nickname || null,
      qq: user.qq ?? null,
      avatar_url: user.avatar_url ?? null,
      bind_secret: bindSecret
    });
  }
  // ---------- renew：机器人调用（anon key + bind_secret），JWT 过期后换新 token ----------
  if (action === "renew") {
    const secret = String(body?.secret ?? "");
    if (!secret) return json({
      ok: false,
      msg: "缺少 secret"
    }, 400);
    const { data: row } = await supabase.from("qq_bind_secrets").select("user_id").eq("secret_hash", await sha256Hex(secret)).maybeSingle();
    if (!row) return json({
      ok: false,
      msg: "secret 无效"
    }, 401);
    // 列名为 role（不是 app_role）；signUserJwt 内部再映射成 JWT 的 app_role claim
    const { data: u } = await supabase.from("users").select("id, username, nickname, role, status, avatar_url, qq").eq("id", row.user_id).single();
    // 和 exchange 保持同一套准入：账号必须存在且审核通过
    if (!u || u.status !== "approved") return json({
      ok: false,
      msg: "账号不可用"
    }, 401);
    const token = await signUserJwt(u);
    await supabase.from("qq_bind_secrets").update({
      last_used_at: new Date().toISOString()
    }).eq("user_id", row.user_id);
    return json({
      ok: true,
      token,
      expires_in: 604800,
      username: u.username,
      qq: u.qq
    });
  }
  return json({
    ok: false,
    msg: "未知 action"
  }, 400);
});
