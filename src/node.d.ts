/**
 * node.d.ts — @app/auth 服务端密码学原语的类型（手写声明，与 node.mjs 同步维护）
 */

/** 微信回调同款验签：sha1([token,timestamp,nonce] 字典序拼接) 与 signature 比对 */
export declare function sha1SignatureOk(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string
): boolean

/** 会话签名：base64url(HMAC-SHA256(key=sha256(secret), msg=payload)) */
export declare function hmacSign(payload: string, secret: string): string

/** 校验 `<payload>.<sig>` 签名值；通过返回 payload，否则 null */
export declare function hmacVerify(value: string, secret: string): string | null

/* ---- callAuthServer（auth-server 门面客户端） ---- */

/** 门面调用默认超时：15s（wordinput/fang 单源；ka 另传 8000） */
export declare const AUTH_SERVER_TIMEOUT_MS: 15000

/** 失败错误码：`http_<status>` 供调用方按状态映射（401 未授权 / 5xx 上游） */
export type CallAuthServerError =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'bad_json'
  | `http_${number}`

/** 成功返回已解析 JSON（对象）；失败归一错误码，不上抛 */
export type CallAuthServerResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; error: CallAuthServerError }

export interface CallAuthServerOptions {
  /** 共享密钥，写 `x-auth-secret` 头；缺失 → 'not_configured' */
  secret?: string
  /** 超时毫秒，缺省 15000 */
  timeoutMs?: number
}

/**
 * 调 auth-server 门面端点（POST JSON + `x-auth-secret`，`cache:no-store`）。
 * 成功 → `{ ok:true, data }`；失败（未配置/超时/网络/非 2xx/非 JSON）→ `{ ok:false, error }`，不抛错。
 */
export declare function callAuthServer<T = Record<string, unknown>>(
  baseUrl: string,
  path: string,
  payload: unknown,
  opts?: CallAuthServerOptions
): Promise<CallAuthServerResult<T>>

/* ---- 统一会话原语（B1.4） ---- */

/**
 * 会话值版本前缀（'v1'）。值格式 `v1.<uid>.<iat>.<b64url(sig)>`，
 * sig=HMAC-SHA256(key=sha256(secret), msg=`v1.<uid>.<iat>`)（base64url）——
 * 与 apps/hmd/src/lib/session.ts 同算法（key=sha256(secret) 派生 + base64url + 末段 '.' 切分），
 * 差异仅在 payload 段数（hmd=`<prefix>.<uid>`；本层=`v1.<uid>.<iat>`，把 iat 纳入签名以支持静默续期）。
 */
export declare const SESSION_VERSION: 'v1'

export interface IssueSessionOptions {
  /** 签名密钥（内部 sha256 派生为 HMAC key）；必填 */
  secret: string
  /** 会话 TTL（秒），缺省 172800（48h）；仅回传 maxAgeSec，不参与签名 */
  ttlSec?: number
}

export interface IssuedSession {
  uid: string
  /** 签发时间（Unix 秒） */
  iat: number
  /** 会话值 `v1.<uid>.<iat>.<sig>` */
  value: string
  maxAgeSec: number
}

/** 签发会话值；uid 须匹配 `/^[A-Za-z0-9_-]{8,64}$/`，secret 缺失抛 TypeError */
export declare function issueSession(uid: string, opts: IssueSessionOptions): IssuedSession

export interface ReadSessionOptions {
  secret?: string
}

/**
 * 读会话值：验签通过且形态合法 → `{ uid, iat }`（iat=Unix 秒），否则 null（不抛错）。
 */
export declare function readSession(
  value: unknown,
  opts?: ReadSessionOptions
): { uid: string; iat: number } | null

export interface RenewIfStaleOptions {
  /** 会话 TTL（秒），缺省 172800（48h） */
  ttlSec?: number
  /** 半衰期（秒），缺省 ttlSec/2；续期阈值上限收敛为 ttlSec */
  halfLife?: number
}

/**
 * 判会话是否已过续期点：age=now-iat，age ≥ 半衰期 → true。
 * iat 非法（NaN/≤0）→ true；iat 在未来（时钟偏移）→ false。
 */
export declare function renewIfStale(iat: number, opts?: RenewIfStaleOptions): boolean

/* ---- 旧 cookie 双读（迁移期） ---- */

/** 旧 hmd 匿名会话 cookie 名（'hmd2'） */
export declare const LEGACY_HMD_COOKIE: 'hmd2'
/** 旧 hmd 微信身份会话 cookie 名（'hmd2w'） */
export declare const LEGACY_HMD_WECHAT_COOKIE: 'hmd2w'
/** 旧 wordinput 会话 cookie 名（'wi_session'） */
export declare const LEGACY_WORDINPUT_COOKIE: 'wi_session'
/** 旧 fang 会话 cookie 名（'fang_session'） */
export declare const LEGACY_FANG_COOKIE: 'fang_session'
/** 全部旧会话 cookie 名（双读遍历顺序：HMAC 系优先，其次 token 系） */
export declare const LEGACY_SESSION_COOKIES: readonly string[]

/** 从原始 `Cookie:` 头取指定 cookie 值；缺失/非法 → null，不抛错 */
export declare function readCookieValue(cookieHeader: unknown, name: string): string | null

/** 旧会话双读命中形状（hmac=hmd 系已验签 uid；token=服务端 64hex，有效性仍需查库） */
export type LegacySession =
  | { source: string; kind: 'hmac'; uid: string }
  | { source: string; kind: 'token'; token: string }

/**
 * 双读旧会话 cookie（hmd2/hmd2w 验签；wi_session/fang_session 校验 64hex）；均未命中 → null。
 * hmd 系 `source` 取值前缀变体（'hmd2'=匿名 / 'hmd2w'=微信），兼容「cookie 名==值前缀」与
 * 真实存量「cookie 名恒为 hmd2、值前缀区分」两种形态。
 */
export declare function readLegacySession(
  cookieHeader: unknown,
  opts?: ReadSessionOptions
): LegacySession | null

/* ---- 微信小程序换码（code → openid/unionid） ---- */

/** jscode2session 默认超时（ms） */
export declare const WEAPP_TIMEOUT_MS: 5000

/** 换码失败错误码：not_configured 未配 appid/secret · bad_code 入参非法 · network 网络/超时 · upstream 非 200/无 openid · bad_json 非 JSON · invalid_code 微信 errcode */
export type WeappExchangeError =
  | 'not_configured'
  | 'bad_code'
  | 'network'
  | 'upstream'
  | 'bad_json'
  | 'invalid_code'

export interface WeappExchangeOptions {
  code?: string
  appId?: string
  appSecret?: string
  /** 超时毫秒，缺省 5000 */
  timeoutMs?: number
}

export type WeappExchangeResult =
  | { ok: true; openid: string; unionid: string | null; sessionKey: string | null }
  | { ok: false; error: WeappExchangeError; errcode?: number }

/**
 * 用 `Taro.login` 的 code 换 openid / unionid（微信 `jscode2session`）。
 * 失败归一为 `{ ok:false, error }`，不抛错。绑定同一微信开放平台后返回 `unionid`（统一账号的锚键）。
 */
export declare function exchangeWeappCode(opts: WeappExchangeOptions): Promise<WeappExchangeResult>

