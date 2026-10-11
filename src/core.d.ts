/**
 * core.d.ts — @app/auth 同构层的类型（手写声明，与 core.mjs 同步维护）
 */

/** SSO 全域票根 Cookie 名（'sl_web_session'） */
export declare const SSO_TICKET_COOKIE: 'sl_web_session'

/** 应用统一会话 Cookie 名（'app_session'） */
export declare const APP_SESSION_COOKIE: 'app_session'

/** 微信标记会话 Cookie 名（'app_session_w'；微信身份由 cookie 名承载，值同统一会话格式） */
export declare const APP_SESSION_WECHAT_COOKIE: 'app_session_w'

/** 统一会话 TTL（秒）：172800 = 48h */
export declare const SESSION_TTL_SEC: 172800

/** 统一会话值形态 `v1.<uid>.<iat>.<b64url sig>`（4 段；仅形状不验签） */
export declare const APP_SESSION_VALUE_RE: RegExp

/** 判值是否为统一会话格式（`v1.<uid>.<iat>.<sig>`；只判形状不验签） */
export declare function isSessionValue(v: unknown): v is string

/** 由身份类别取会话 Cookie 名：wechat → 'app_session_w'，否则 'app_session' */
export declare function sessionCookieName(opts?: { wechat?: boolean }): string

/** 判值是否为合法票根（48 位 hex，大小写不敏感） */
export declare function isTicket(v: unknown): v is string

/** PC 扫码登录 scene 前缀（'ssologin-'） */
export declare const SSO_SCENE_PREFIX: 'ssologin-'

/** 判值是否 SSO 登录 scene（前缀匹配） */
export declare function isSsoScene(v: unknown): boolean

/** 微信 provider 名（'wechat'） */
export declare const WECHAT_PROVIDER: 'wechat'

/** auth 中转站 origin（'https://auth.hxym18.com'） */
export declare const AUTH_ORIGIN: string

/** CloudBase 环境 ID（auth 站云环境；'cloud1-5gmlb2qmf0f1963b'） */
export declare const CLOUD_ENV_ID: string

/** 无/非法 redirect 时的兜底落点（'https://hxym18.com/'） */
export declare const DEFAULT_REDIRECT: string

/** redirect 白名单：仅 https 且 host 为 hxym18.com 或以 .hxym18.com 结尾 */
export declare function isAllowedRedirect(url: unknown): url is string

/** 构造 auth 中转站跳转 URL；非法/缺失 redirectUrl 落 fallback */
export declare function buildAuthRedirect(
  redirectUrl?: unknown,
  opts?: { origin?: string; fallback?: string }
): string

/** 昵称缺省回退（'微信用户'） */
export declare const DEFAULT_DISPLAY_NAME: '微信用户'

/** 资料回退：昵称空 → '微信用户'；头像空 → '' */
export declare function profileFallback(profile?: {
  nickname?: string | null
  avatar?: string | null
}): { nickname: string; avatar: string }

/**
 * 登录通道能力位：`@hxym18/env` 的 `capabilities()` → 控制器认的 `{ isWechatInApp, isMobileBrowser }`。
 * 唯一桥接（消费方勿手写）；按结构类型取参，故不依赖 env。
 */
export declare function loginCapsFromCapabilities(caps?: {
  isWechatMobile?: boolean
  isMobile?: boolean
} | null): { isWechatInApp: boolean; isMobileBrowser: boolean }
