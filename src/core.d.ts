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

/**
 * 会话 cookie 的 `Secure` 决策（单一口径，签发侧与续期侧共用）：
 * 默认恒 `true`（不看 `NODE_ENV`）；仅显式 `secure === false` **且** 非生产
 * （`envGet('NODE_ENV') !== 'production'`）→ `false`；生产里显式 `false` 无效（fail-closed 仍 `true`）。
 */
export declare function resolveSessionSecure(
  envGet: (key: string) => string | undefined,
  secure?: unknown
): boolean

export interface RenewIfStaleOptions {
  /** 会话 TTL（秒），缺省 172800（48h） */
  ttlSec?: number
  /** 半衰期（秒），缺省 ttlSec/2；续期阈值上限收敛为 ttlSec */
  halfLife?: number
}

/**
 * 判会话是否已过续期点：age=now-iat，age ≥ 半衰期 → true（纯函数，零 crypto，Edge 可载）。
 * iat 非法（NaN/≤0）→ true；iat 在未来（时钟偏移）→ false。重签回写限 Node（`node.mjs` 的 `renewSession`）。
 */
export declare function renewIfStale(iat: number, opts?: RenewIfStaleOptions): boolean

/** 迁移期旧 hmd 匿名会话 cookie 名（'hmd2'） */
export declare const LEGACY_HMD_COOKIE: 'hmd2'
/** 迁移期旧 hmd 微信身份会话 cookie 名（'hmd2w'） */
export declare const LEGACY_HMD_WECHAT_COOKIE: 'hmd2w'
/** 迁移期旧 wordinput 会话 cookie 名（'wi_session'，服务端 64hex token） */
export declare const LEGACY_WORDINPUT_COOKIE: 'wi_session'
/** 迁移期旧 fang 会话 cookie 名（'fang_session'，服务端 64hex token） */
export declare const LEGACY_FANG_COOKIE: 'fang_session'
/** 全部旧会话 cookie 名（双读遍历顺序：HMAC 系优先，其次 token 系） */
export declare const LEGACY_SESSION_COOKIES: readonly string[]
/**
 * 服务端 token cookie 值形态：64 位**小写** hex（`sessions.token`）。
 * 仅供格式粗判（Edge middleware 可直用），有效性仍需查各站 `sessions` 表。
 */
export declare const LEGACY_HEX_RE: RegExp

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

/**
 * 敏感前缀契约常量（`/s/` `/r/` `/api/`；供跨包门禁核对，不驱动 auth 运行期）。
 * 与 pwa-kit `SENSITIVE_PREFIXES`、analytics `DEFAULT_DENY_PREFIXES` 集合相等；不得少于必需项。
 */
export declare const SENSITIVE_PREFIXES: readonly string[]

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
