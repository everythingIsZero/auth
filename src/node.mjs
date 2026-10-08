/**
 * node.mjs — @app/auth 服务端密码学原语（Node-only，import node:crypto）
 *
 * 收敛三套服务端能力（单源 docs/platform-standards.md §3）：
 *   ① 微信回调同款 URL 验签：sha1([token,timestamp,nonce] 字典序拼接)
 *      ← apps/hmd/src/lib/wechat-callback.ts verifySignature
 *      ← apps/hmd/src/lib/admin-auth.ts checkAdminSignature（复用同款）
 *      ← deploy/auth-server/index.js verifySignature
 *   ② 会话 cookie HMAC-SHA256 签名（base64url）：
 *      ← apps/hmd/src/lib/session.ts hmacSha256/verify（key = sha256(secret)，值 = `<payload>.<sig>`）
 *   ③ auth-server 门面客户端 + 统一会话原语（B1.4）：
 *      - callAuthServer ← apps/wordinput/src/lib/hmd-client.ts、
 *        apps/fang/src/lib/auth-server-client.ts、apps/ka/server/src/qr.ts
 *        三处逐字核对：POST JSON + header `x-auth-secret`，15s 超时（ka 用 8s）
 *        （前两处随 2026-09-16 SSO 配置驱动批 U4/U6 迁移已删；ka 侧仍自带实现，待项目侧迁移）
 *      - issueSession / readSession / renewIfStale：版本前缀会话值（v1）+ 48h TTL + 静默续期
 *      - 旧 cookie 双读：hmd2/hmd2w（HMAC 系）+ wi_session/fang_session（64hex 服务端 token 系）
 *
 * Edge / 浏览器不可用本模块（无 node:crypto）；同构常量与纯函数见同包 core.mjs。
 */
import crypto from 'node:crypto'
import { SESSION_TTL_SEC } from './core.mjs'

/**
 * 微信回调同款验签：sha1([token,timestamp,nonce] 字典序拼接) 与 signature 比对。
 * 恒时比较防时序侧信道；任一入参为空（token 未配置等）判 false，不抛错。
 * @param {string} token 回调 Token（部署侧注入，空 = 验签面关闭）
 * @param {string} timestamp
 * @param {string} nonce
 * @param {string} signature 微信传来的 sha1 hex
 * @returns {boolean}
 */
export function sha1SignatureOk(token, timestamp, nonce, signature) {
  if (!token || !timestamp || !nonce || !signature) return false
  const digest = crypto
    .createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest('hex')
  const a = Buffer.from(digest)
  const b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** HMAC 密钥派生：sha256(secret)（对齐 hmd session.ts hmacKey 口径） */
function hmacKey(secret) {
  return crypto.createHash('sha256').update(String(secret == null ? '' : secret)).digest()
}

/**
 * 会话签名：base64url(HMAC-SHA256(key=sha256(secret), msg=payload))。
 * 算法口径对齐 apps/hmd/src/lib/session.ts 的 hmacSha256（存量 hmd2 / hmd2w cookie 即此格式）。
 * 消费方按 `<payload>.${hmacSign(payload, secret)}` 组装签名值；hmacVerify 做逆向校验。
 * @param {string} payload 待签名明文
 * @param {string} secret 密钥（内部先 sha256 派生，不直接用原串作 key）
 * @returns {string} base64url 签名
 */
export function hmacSign(payload, secret) {
  return crypto.createHmac('sha256', hmacKey(secret)).update(String(payload == null ? '' : payload)).digest('base64url')
}

/**
 * 校验签名值：value 形如 `<payload>.<sig>`（hmd 的 `prefix.uid.sig` / zuju 的 `payload.sig` 均适配，
 * 以最后一个 '.' 切分）。签名一致（恒时比较）→ 返回 payload 原文，否则 null，不抛错。
 * @param {string} value 带签名的值
 * @param {string} secret 密钥
 * @returns {string | null} 验签通过返回 payload，否则 null
 */
export function hmacVerify(value, secret) {
  if (typeof value !== 'string' || !secret) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0 || dot === value.length - 1) return null
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = hmacSign(payload, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  try {
    return crypto.timingSafeEqual(a, b) ? payload : null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- *
 * ③a. auth-server 门面客户端（callAuthServer）
 * 契约逐字核对（2026-09-14，未臆造）：
 *   - deploy/auth-server/index.js handleQr：POST /api/auth/qr/{issue,poll}，
 *     鉴权头 `x-auth-secret`（不符 401 {error:'unauthorized'}）；
 *     issue → {ok:true,scene,qrUrl,expiresIn}；poll → {ok:true,status,...}；上游故障 502 {error:'upstream'}
 *   - apps/wordinput/src/lib/hmd-client.ts、apps/fang/src/lib/auth-server-client.ts：
 *     POST JSON，头 {content-type, x-auth-secret}，AbortSignal.timeout(15000)，cache:'no-store'
 *   - apps/ka/server/src/qr.ts：POST JSON，头 {content-type, x-auth-secret}，8s 超时
 * 本函数只归一错误，不上抛（网络/超时/非 2xx/非 JSON 都返回 {ok:false,error}）。
 * -------------------------------------------------------------------------- */

/** 门面调用默认超时：15s（wordinput/fang 单源；ka 另传 8000） */
export const AUTH_SERVER_TIMEOUT_MS = 15000

/** 失败错误码 → `{ok:false,error}`；`http_<status>` 供调用方按状态映射（401 未授权 / 5xx 上游） */
function isTimeoutError(err) {
  const name = err && err.name
  return name === 'TimeoutError' || name === 'AbortError'
}

/**
 * 调 auth-server 门面端点。逐字契约：POST JSON，头 `content-type: application/json` + `x-auth-secret`。
 * 成功 → `{ ok:true, data }`（data=已解析 JSON）；失败归一为 `{ ok:false, error }` 不上抛：
 *   'not_configured' baseUrl/secret 缺失 · 'timeout' 超时 · 'network' 网络/连接异常
 *   `http_<status>`  非 2xx · 'bad_json' 2xx 但响应非 JSON 对象
 *
 * @param {string} baseUrl 门面基址（如 http://auth-server:3000；尾斜杠自动归一）
 * @param {string} path    端点路径（如 /api/auth/qr/issue）
 * @param {unknown} payload 请求体（JSON.stringify；null/undefined → {}）
 * @param {{ secret?: string, timeoutMs?: number }} [opts] secret=共享密钥；timeoutMs 缺省 15000
 * @returns {Promise<{ ok: true, data: Record<string, unknown> } | { ok: false, error: string }>}
 */
export async function callAuthServer(baseUrl, path, payload, opts = {}) {
  const secret = opts && opts.secret
  if (typeof baseUrl !== 'string' || !baseUrl || typeof secret !== 'string' || !secret) {
    return { ok: false, error: 'not_configured' }
  }
  if (typeof fetch !== 'function') return { ok: false, error: 'network' }
  const timeoutRaw = opts && opts.timeoutMs != null ? Number(opts.timeoutMs) : AUTH_SERVER_TIMEOUT_MS
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : AUTH_SERVER_TIMEOUT_MS
  const url = baseUrl.replace(/\/+$/, '') + (typeof path === 'string' ? path : '')

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-auth-secret': secret },
      body: JSON.stringify(payload == null ? {} : payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return { ok: false, error: isTimeoutError(err) ? 'timeout' : 'network' }
  }

  if (!res.ok) return { ok: false, error: `http_${res.status}` }
  let data
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: 'bad_json' }
  }
  if (data == null || typeof data !== 'object') return { ok: false, error: 'bad_json' }
  return { ok: true, data }
}

/* -------------------------------------------------------------------------- *
 * ③b. 统一会话原语（B1.4）
 *
 * 会话值格式：`v1.<uid>.<iat>.<b64url(sig)>`，其中 payload=`v1.<uid>.<iat>`、
 * sig=HMAC-SHA256(key=sha256(secret), msg=payload)（base64url）。版本前缀 v1 保证可迁移。
 * HMAC 口径与 apps/hmd/src/lib/session.ts 逐项对齐（key=sha256(secret) 派生，
 * base64url，最后一个 '.' 切分 `<payload>.<sig>`）——故存量 hmd2/hmd2w 与本格式同算法可复用
 * hmacSign/hmacVerify；差异仅在 payload 段数（hmd=`<prefix>.<uid>`，本层=`v1.<uid>.<iat>`）。
 *
 * 与 hmd 存量格式的取舍：hmd cookie 的 TTL 只存 Max-Age（值内无 iat），无法判断"该续期了"；
 * B1.4 把 iat 写进签名 payload，readSession 才可返回 iat、renewIfStale 才能据"半衰期"静默续期。
 * -------------------------------------------------------------------------- */

/** 会话值版本前缀（格式演进/迁移锚点） */
export const SESSION_VERSION = 'v1'

/** uid 白字：与 hmd session.ts verify 同口径（字母数字 + - _，8..64） */
const SESSION_UID_RE = /^[A-Za-z0-9_-]{8,64}$/
/** payload 形态：v1.<uid>.<iat 秒级整数>（签名前原文，uid 不含 '.'） */
const SESSION_PAYLOAD_RE = /^v1\.([^.]+)\.(\d+)$/

/**
 * 签发会话值（`v1.<uid>.<iat>.<sig>`）。
 * @param {string} uid 用户标识（字母数字 + - _，8..64；不得含 '.'）
 * @param {{ secret: string, ttlSec?: number }} opts secret 必填；ttlSec 缺省 172800（48h），仅回传 maxAgeSec
 * @returns {{ uid: string, iat: number, value: string, maxAgeSec: number }}
 * @throws {TypeError} uid 非法 / secret 缺失（编程错误，非运行时数据）
 */
export function issueSession(uid, opts) {
  const secret = opts && opts.secret
  if (typeof secret !== 'string' || !secret) throw new TypeError('issueSession: secret is required')
  if (typeof uid !== 'string' || !SESSION_UID_RE.test(uid)) throw new TypeError('issueSession: invalid uid')
  const ttlRaw = opts && opts.ttlSec != null ? Number(opts.ttlSec) : SESSION_TTL_SEC
  const ttlSec = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : SESSION_TTL_SEC
  const iat = Math.floor(Date.now() / 1000)
  const payload = `${SESSION_VERSION}.${uid}.${iat}`
  return { uid, iat, value: `${payload}.${hmacSign(payload, secret)}`, maxAgeSec: ttlSec }
}

/**
 * 读会话值：验签通过且形态合法 → `{ uid, iat }`（iat=Unix 秒），否则 null（不抛错）。
 * @param {unknown} value 会话 cookie / Bearer token 值
 * @param {{ secret?: string }} [opts]
 * @returns {{ uid: string, iat: number } | null}
 */
export function readSession(value, opts) {
  const secret = opts && opts.secret
  if (typeof value !== 'string' || !secret) return null
  const payload = hmacVerify(value, secret)
  if (!payload) return null
  const m = SESSION_PAYLOAD_RE.exec(payload)
  if (!m) return null
  const iat = Number(m[2])
  if (!Number.isFinite(iat) || iat <= 0) return null
  return { uid: m[1], iat }
}

/**
 * 判会话是否已过"续期点"（静默续期决策，不验签——iat 由 readSession 产出）。
 * 判定：age=now-iat；age ≥ 半衰期 → true。半衰期缺省 ttlSec/2（48h → 24h），
 * 上限收敛为 ttlSec（即便传入更大的 halfLife，到期前也必续）。
 * iat 非法（NaN/≤0）→ true（保守起见按需续期）；iat 在未来（时钟偏移）→ false。
 *
 * @param {number} iat 签发时间（Unix 秒，readSession 产物）
 * @param {{ ttlSec?: number, halfLife?: number }} [opts]
 * @returns {boolean} true=已陈旧，调用方应重签会话；false=仍新鲜
 */
export function renewIfStale(iat, opts) {
  if (!Number.isFinite(iat) || iat <= 0) return true
  const ttlRaw = opts && opts.ttlSec != null ? Number(opts.ttlSec) : SESSION_TTL_SEC
  const ttlSec = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : SESSION_TTL_SEC
  const halfRaw = opts && opts.halfLife != null ? Number(opts.halfLife) : ttlSec / 2
  const halfLife = Number.isFinite(halfRaw) && halfRaw > 0 ? halfRaw : ttlSec / 2
  const threshold = Math.min(halfLife, ttlSec)
  const age = Math.floor(Date.now() / 1000) - iat
  if (age < 0) return false
  return age >= threshold
}

/* -------------------------------------------------------------------------- *
 * ③c. 旧 cookie 双读辅助（迁移期）
 *
 * 存量 cookie 名与格式（2026-09-14 核对）：
 *   - hmd2 / hmd2w：HMAC 系，`<prefix>.<uid>.<b64url(hmac)>`，key=sha256(secret)
 *     ← apps/hmd/src/lib/session.ts（hmd2 匿名 / hmd2w 微信身份）
 *   - wi_session：服务端 64 位 hex token（sessions 表）← apps/wordinput/src/lib/auth.ts
 *   - fang_session：服务端 64 位 hex token（sessions 表）← apps/fang/src/lib/auth.ts
 * token 系只能本地校验格式，有效性仍需查各自 DB（本包不做 DB）。
 * -------------------------------------------------------------------------- */

/** 旧 hmd 匿名会话 cookie 名 */
export const LEGACY_HMD_COOKIE = 'hmd2'
/** 旧 hmd 微信身份会话 cookie 名 */
export const LEGACY_HMD_WECHAT_COOKIE = 'hmd2w'
/** 旧 wordinput 会话 cookie 名（服务端 64hex token） */
export const LEGACY_WORDINPUT_COOKIE = 'wi_session'
/** 旧 fang 会话 cookie 名（服务端 64hex token） */
export const LEGACY_FANG_COOKIE = 'fang_session'
/** 全部旧会话 cookie 名（双读遍历顺序：HMAC 系优先，其次 token 系） */
export const LEGACY_SESSION_COOKIES = [
  LEGACY_HMD_WECHAT_COOKIE,
  LEGACY_HMD_COOKIE,
  LEGACY_WORDINPUT_COOKIE,
  LEGACY_FANG_COOKIE,
]

/** 服务端 token cookie 格式：64 位小写 hex（wi_session/fang_session） */
const LEGACY_TOKEN_RE = /^[a-f0-9]{64}$/

/**
 * 从原始 Cookie 头取指定 cookie 值（按首个 '=' 切分，值含 '=' 也安全；decode 失败回原文，不抛错）。
 * @param {unknown} cookieHeader 原始 `Cookie:` 头字符串
 * @param {string} name cookie 名
 * @returns {string | null}
 */
export function readCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || !cookieHeader || typeof name !== 'string' || !name) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    const raw = part.slice(eq + 1).trim()
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

/**
 * 双读旧会话 cookie（迁移期入口）。按 LEGACY_SESSION_COOKIES 顺序：
 *   - hmd2/hmd2w 命中且 HMAC 验签通过 → `{ source, kind:'hmac', uid }`（source=值前缀变体）
 *   - wi_session/fang_session 命中且 64hex → `{ source, kind:'token', token }`（有效性仍需查库）
 * 均未命中 → null（不抛错）。
 *
 * hmd 存量两种形态都支持（2026-09-14 核对）：
 *   ① cookie 名 == 值前缀：`hmd2=<hmd2.uid.sig>` / `hmd2w=<hmd2w.uid.sig>`
 *   ② 真实存量：cookie 名恒为 `hmd2`，用**值前缀** `hmd2.`/`hmd2w.` 区分匿名/微信
 *      （旧实现按 cookie 名 hmd2w 匹配，形态 ② 对不上恒返回 null）。
 * 命中返回的 `source` 一律取**值前缀**（'hmd2'/'hmd2w'），故调用方可据此判微信标记。
 *
 * @param {unknown} cookieHeader 原始 `Cookie:` 头
 * @param {{ secret?: string }} [opts] secret=hmd 系验签密钥；缺省则跳过 HMAC 系
 * @returns {{ source: string, kind: 'hmac', uid: string } | { source: string, kind: 'token', token: string } | null}
 */
export function readLegacySession(cookieHeader, opts) {
  const secret = opts && opts.secret
  for (const name of LEGACY_SESSION_COOKIES) {
    const v = readCookieValue(cookieHeader, name)
    if (!v) continue
    const isHmac = name === LEGACY_HMD_COOKIE || name === LEGACY_HMD_WECHAT_COOKIE
    if (isHmac) {
      if (!secret) continue
      const payload = hmacVerify(v, secret)
      if (!payload) continue
      const variant = payload.startsWith('hmd2w.') ? 'hmd2w' : payload.startsWith('hmd2.') ? 'hmd2' : null
      if (!variant) continue
      const uid = payload.slice(variant.length + 1)
      if (SESSION_UID_RE.test(uid)) return { source: variant, kind: 'hmac', uid }
    } else if (LEGACY_TOKEN_RE.test(v)) {
      return { source: name, kind: 'token', token: v }
    }
  }
  return null
}
