/**
 * core.mjs — @app/auth 同构层（零依赖、纯净、可在 Edge / 浏览器 / Node 跑）
 *
 * 收敛票根格式、cookie 名、provider 名、scene 格式、SSO 跳转与 redirect 白名单。
 * 本层不 import 任何 Node 内置模块，只用 Web 标准（URL / RegExp），
 * 故 Next.js Edge runtime 可直载。需要 Node 密码学原语（sha1 验签 / HMAC）的
 * 消费方改用同包的 node.mjs（Node-only）。
 *
 * 取值逐项核对（2026-09-14，未臆造）：
 *   - SSO_TICKET_COOKIE / SESSION_TTL_SEC / isTicket / 白名单 / SSO 跳转
 *     ← deploy/auth/index.html（COOKIE_NAME='sl_web_session'、SESSION_RE=/^[0-9a-f]{48}$/i、
 *       max-age=172800、AUTH_ORIGIN、DEFAULT_REDIRECT、readRedirect 的 https+host 白名单）
 *   - SSO_SCENE_PREFIX ← deploy/auth-server/index.js（SSO_SCENE_PREFIX='ssologin-'）
 *   - WECHAT_PROVIDER ← identities(provider='wechat', …)
 *   - CLOUD_ENV_ID ← deploy/auth/index.html（CLOUD_ENV='cloud1-5gmlb2qmf0f1963b'，
 *       auth 站云环境；与 @app/ai-client DEFAULT_ENV_ID 同环境）
 */

/** SSO 全域票根 Cookie 名（非 httpOnly，业务站前端 JS 需读来换会话；单源 deploy/auth/index.html） */
export const SSO_TICKET_COOKIE = 'sl_web_session'

/** 应用统一会话 Cookie 名（@app/auth 收敛后的服务端会话层） */
export const APP_SESSION_COOKIE = 'app_session'

/**
 * 微信标记会话 Cookie 名（'app_session_w'）。
 * 统一会话值只含 uid/iat（无 provider/claim 位），故「微信身份」标记改由 cookie 名承载：
 * 微信会话存本名，匿名/基础会话存 APP_SESSION_COOKIE。
 * 消费方（含 Edge middleware）一律从此取，不再各 app 手写。
 */
export const APP_SESSION_WECHAT_COOKIE = 'app_session_w'

/** 统一会话 TTL：48 小时（= 172800 秒；与 webAuth web_sessions、auth 站 Cookie max-age 严格同值） */
export const SESSION_TTL_SEC = 172800

/**
 * 统一会话值形态：`v1.<uid>.<iat>.<b64url sig>`（4 段，与 node.mjs issueSession 产物严格一致）。
 * uid=[A-Za-z0-9_-]{8,64}、iat=秒级整数、sig=base64url。仅形状匹配、不验签——
 * Edge/浏览器侧用它做「有无合法会话」的粗判，真伪由服务端 readSession（node.mjs）兜底。
 */
export const APP_SESSION_VALUE_RE = /^v1\.[A-Za-z0-9_-]{8,64}\.\d+\.[A-Za-z0-9_-]+$/

/**
 * 判值是否为统一会话格式（`v1.<uid>.<iat>.<sig>`；只判形状不验签）。
 * @param {unknown} v
 * @returns {boolean}
 */
export function isSessionValue(v) {
  return typeof v === 'string' && APP_SESSION_VALUE_RE.test(v)
}

/**
 * 由身份类别取会话 Cookie 名：微信标记 → APP_SESSION_WECHAT_COOKIE，匿名/基础 → APP_SESSION_COOKIE。
 * @param {{ wechat?: boolean }} [opts]
 * @returns {string} 'app_session_w' | 'app_session'
 */
export function sessionCookieName(opts) {
  return opts && opts.wechat ? APP_SESSION_WECHAT_COOKIE : APP_SESSION_COOKIE
}

/**
 * 会话 cookie 的 `Secure` 决策（**单一口径**：签发侧 `createAuthServer` 与续期侧 `renewSession` 共用）。
 *
 * 语义（S6「生产强制 Secure，不依赖 NODE_ENV 默认」）：
 *   - **默认恒 `true`**——不看 `NODE_ENV`，生产路径不可能漏掉 `Secure`。
 *   - 仅当显式 `secure === false` **且** 当前**非生产**（`envGet('NODE_ENV') !== 'production'`）→ 才 `false`，
 *     供本地 http 开发。
 *   - **fail-closed**：生产里显式 `false` **无效**（仍 `true`）——宁 cookie 被 http 环境拒绝（显式误配可见），
 *     也不静默丢弃 `Secure`。
 *
 * 纯函数、零依赖（只读注入的 env 访问器），故可放同构层 core。
 *
 * @param {(key: string) => string | undefined} envGet env 访问器（注入或 `process.env`）
 * @param {unknown} secure 显式配置；只有**严格 `false`** 才可能关，其余（含缺省/`true`）→ `true`
 * @returns {boolean}
 */
export function resolveSessionSecure(envGet, secure) {
  if (secure !== false) return true
  const ne = typeof envGet === 'function' ? envGet('NODE_ENV') : undefined
  return String(ne == null ? '' : ne) === 'production'
}

/**
 * 判会话是否已过"续期点"（静默续期决策，纯函数、**零密码学依赖**，故可在 Edge / 浏览器跑）。
 * 判定：age=now-iat；age ≥ 半衰期 → true。半衰期缺省 ttlSec/2（48h → 24h），
 * 上限收敛为 ttlSec（即便传入更大的 halfLife，到期前也必续）。
 * iat 非法（NaN/≤0）→ true（保守起见按需续期）；iat 在未来（时钟偏移）→ false。
 *
 * 运行时边界（S6）：本函数只做判定；**重签回写需 Node 密码学原语，仅 Node 运行时**（`node.mjs` 的
 * `renewSession`）。**Edge middleware 不能续期**，Edge 站把续期落到 Node 端点。
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

/**
 * 迁移期旧会话常量（**同构层单源**）：旧 cookie 名 + 服务端 64hex token 形态。
 *
 * 为什么在 core：旧 cookie 名与 64hex 正则是迁移期各站 `/lib/auth.ts` 与 Edge `middleware.ts`
 * 逐字复制/硬编码的**纯常量**（审计 A3）。Edge middleware 引不了 `node` 出口，故只能放本层
 * （零 Node 依赖，Edge 可直载）；Edge 侧只取常量做格式粗判，真伪仍由 Node 侧验签/查库兜底。
 *
 * 取值单源（2026-09-14 核对）：`hmd2`/`hmd2w` ← apps/hmd/src/lib/session.ts；
 * `wi_session` ← wordinput、`fang_session` ← fang（服务端 `sessions` 表 64hex token）。
 */
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

/**
 * 服务端 token cookie 值形态：64 位**小写** hex（`sessions.token`；`wi_session` / `fang_session`）。
 * 仅供格式粗判——token 是否有效仍需查各自站点 `sessions` 表（本包不做 DB）。
 */
export const LEGACY_HEX_RE = /^[a-f0-9]{64}$/

/** 票根格式：48 位 hex（192bit 随机，大小写不敏感）；单源 auth 站 SESSION_RE */
const TICKET_RE = /^[0-9a-f]{48}$/i

/**
 * 判值是否为合法票根：48 位 hex（大小写不敏感）。
 * @param {unknown} v
 * @returns {boolean}
 */
export function isTicket(v) {
  return typeof v === 'string' && TICKET_RE.test(v)
}

/** PC 扫码登录 scene 前缀（scene_str = 前缀 + 24 位 hex；单源 auth-server SSO_SCENE_PREFIX） */
export const SSO_SCENE_PREFIX = 'ssologin-'

/**
 * 判值是否 SSO 登录 scene：仅判前缀（与 auth-server / auth 站存量口径一致，
 * 不额外校验后缀长度/字符——存量只做 startsWith）。
 * @param {unknown} v
 * @returns {boolean}
 */
export function isSsoScene(v) {
  return typeof v === 'string' && v.startsWith(SSO_SCENE_PREFIX)
}

/** 微信 provider 名（identities.provider 单值） */
export const WECHAT_PROVIDER = 'wechat'

/** auth 中转站 origin（SSO 动线入口；单源 deploy/auth/index.html） */
export const AUTH_ORIGIN = 'https://auth.hxym18.com'

/** CloudBase 环境 ID（auth 站换取会话所用云环境；单源 deploy/auth/index.html CLOUD_ENV） */
export const CLOUD_ENV_ID = 'cloud1-5gmlb2qmf0f1963b'

/**
 * 敏感前缀**契约常量**（供跨包门禁核对，非运行期行为）。
 *
 * auth 自身所有响应已 `no-store`（会话/票根等绝不可缓存），故此常量不驱动 auth 运行期逻辑；
 * 它存在的唯一目的是给 workspace `scripts/e2e/prefix-consistency.test.mjs` 提供**可 import 的单一来源**，
 * 与 pwa-kit `SENSITIVE_PREFIXES`、analytics `DEFAULT_DENY_PREFIXES` 集合相等。
 *
 * **不得少于必需项**（`/s/` `/r/` `/api/`）：只能加不能减。改动须四方同步，否则 harness 即红。
 */
export const SENSITIVE_PREFIXES = Object.freeze(['/s/', '/r/', '/api/'])

/** 无/非法 redirect 时的兜底落点（单源 deploy/auth/index.html DEFAULT_REDIRECT；旧 sl.hxym18.com 已随项目退役） */
export const DEFAULT_REDIRECT = 'https://hxym18.com/'

/**
 * redirect 白名单：仅 https 且 host 等于 hxym18.com 或以 .hxym18.com 结尾。
 * 语义逐字对齐 deploy/auth/index.html readRedirect()（2026-09-10 修 slice(-10) 恒 false 的 bug 后口径）：
 * 防开放跳转钓鱼——外部域 / http / 形如 evil-hxym18.com 均判非法。
 * @param {unknown} url 完整 URL 字符串
 * @returns {boolean}
 */
export function isAllowedRedirect(url) {
  if (typeof url !== 'string' || !url) return false
  let u
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const host = u.hostname
  return host === 'hxym18.com' || host.endsWith('.hxym18.com')
}

/**
 * 构造 auth 中转站跳转 URL（业务站 → auth 站）。
 * 语义对齐 deploy/auth/index.html：`?redirect=<业务站完整URL>`，auth 站 readRedirect
 * 再做白名单校验（非法落 DEFAULT_REDIRECT）。本函数提前做同一白名单校验：
 * 非法/缺失的 redirectUrl 一律改用 fallback，产出永远合法可跳。
 *
 * @param {unknown} redirectUrl 业务站完整 URL（如 https://ka.hxym18.com/）
 * @param {{ origin?: string, fallback?: string }} [opts]
 *        origin 缺省 AUTH_ORIGIN；fallback 缺省 DEFAULT_REDIRECT
 * @returns {string} `${origin}/?redirect=${encodeURIComponent(target)}`
 */
export function buildAuthRedirect(redirectUrl, opts) {
  const origin = (opts && opts.origin) || AUTH_ORIGIN
  const fallback = (opts && opts.fallback) || DEFAULT_REDIRECT
  const target = isAllowedRedirect(redirectUrl) ? redirectUrl : fallback
  return `${origin}/?redirect=${encodeURIComponent(target)}`
}

/** 昵称缺省回退（各端一致；用户没填/微信不给时的显示名） */
export const DEFAULT_DISPLAY_NAME = '微信用户'

/**
 * 资料回退（各站统一，别各写各的）：昵称空 → `DEFAULT_DISPLAY_NAME`；头像空 → 空串（站点自行出占位）。
 * @param {{ nickname?: string|null, avatar?: string|null }} [profile]
 * @returns {{ nickname: string, avatar: string }}
 */
export function profileFallback(profile) {
  const p = profile || {}
  const nickname =
    typeof p.nickname === 'string' && p.nickname.trim() ? p.nickname.trim() : DEFAULT_DISPLAY_NAME
  const avatar = typeof p.avatar === 'string' && p.avatar ? p.avatar : ''
  return { nickname, avatar }
}

/**
 * 登录通道能力位：把 `@hxym18/env` 的 `capabilities()` 投影成控制器认的通道位（**唯一桥接**）。
 *
 * 为什么需要它：env 的 `isWechat` 同时涵盖桌面微信与小程序 webview，而登录的「微信内」通道
 * 只指能走 OAuth 静默授权的**移动微信**——两者同名不同义。若各站各自翻译必漂移
 * （历史上桌面微信被误判进 wechat 通道，跳 OAuth 死路）。故投影只此一处，消费方一律调本函数。
 *
 * 按**结构类型**吃 env 的 Capabilities（不 import env），故 auth 无运行期依赖。
 *
 * @param {{ isWechatMobile?: boolean, isMobile?: boolean } | null | undefined} caps
 *        `@hxym18/env` 的 `capabilities()` 返回值
 * @returns {{ isWechatInApp: boolean, isMobileBrowser: boolean }}
 */
export function loginCapsFromCapabilities(caps) {
  const c = caps || {}
  return {
    isWechatInApp: c.isWechatMobile === true,
    isMobileBrowser: c.isMobile === true,
  }
}
