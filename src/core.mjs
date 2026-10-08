/**
 * core.mjs — @app/auth 同构层（零依赖、纯净、可在 Edge / 浏览器 / Node 跑）
 *
 * 收敛票根格式、cookie 名、provider 名、scene 格式、SSO 跳转与 redirect 白名单
 * （单源 docs/platform-standards.md §3、docs/sso-login-spec.md）。
 * 本层不 import node:crypto / node:buffer，只用 Web 标准（URL / RegExp），
 * 故 Next.js Edge runtime 可直载。需要 Node 密码学原语（sha1 验签 / HMAC）的
 * 消费方改用同包的 node.mjs（Node-only）。
 *
 * 取值逐项核对（2026-09-14，未臆造）：
 *   - SSO_TICKET_COOKIE / SESSION_TTL_SEC / isTicket / 白名单 / SSO 跳转
 *     ← deploy/auth/index.html（COOKIE_NAME='sl_web_session'、SESSION_RE=/^[0-9a-f]{48}$/i、
 *       max-age=172800、AUTH_ORIGIN、DEFAULT_REDIRECT、readRedirect 的 https+host 白名单）
 *     ← docs/sso-login-spec.md「硬约定」
 *   - SSO_SCENE_PREFIX ← deploy/auth-server/index.js（SSO_SCENE_PREFIX='ssologin-'）
 *   - WECHAT_PROVIDER ← docs/platform-standards.md §3（identities(provider='wechat', …)）
 *   - CLOUD_ENV_ID ← deploy/auth/index.html（CLOUD_ENV='cloud1-5gmlb2qmf0f1963b'，
 *       auth 站云环境；与 @app/ai-client DEFAULT_ENV_ID 同环境）
 */

/** SSO 全域票根 Cookie 名（非 httpOnly，业务站前端 JS 需读来换会话；单源 deploy/auth/index.html） */
export const SSO_TICKET_COOKIE = 'sl_web_session'

/** 应用统一会话 Cookie 名（@app/auth 收敛后的服务端会话层；单源 docs/platform-standards.md §3） */
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

/** 微信 provider 名（identities.provider 单值；单源 docs/platform-standards.md §3） */
export const WECHAT_PROVIDER = 'wechat'

/** auth 中转站 origin（SSO 动线入口；单源 deploy/auth/index.html） */
export const AUTH_ORIGIN = 'https://auth.hxym18.com'

/** CloudBase 环境 ID（auth 站换取会话所用云环境；单源 deploy/auth/index.html CLOUD_ENV） */
export const CLOUD_ENV_ID = 'cloud1-5gmlb2qmf0f1963b'

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
