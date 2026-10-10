/**
 * server.d.ts — auth 服务端「认人」核心的类型（框架无关）
 */

/** 锚定器枚举（identity=身份锚 / allowlist=白名单 / first-login=首登） */
export declare const ANCHORS: readonly string[]

/** 身份锚定回调：openid → 本站 uid（各站「怎么用这个人」的唯一入口） */
export type ResolveIdentity = (
  openid: string,
  ctx: {
    source: 'sso' | 'qr' | 'weapp'
    /** 扫码通道拿到的微信昵称（静默通道/没拿到为 null） */
    nickname: string | null
    /** 登录链路顺手拿到的微信头像 URL（没拿到为 null） */
    avatar: string | null
    /**
     * 微信 unionid（仅 weapp 且小程序已绑定同一微信开放平台时有值，否则 null）。
     * 账号统一锚键：可用 `ctx.unionid ?? openid` 归一 H5 与小程序身份。
     */
    unionid: string | null
  },
) =>
  | Promise<{ uid: string; displayName?: string | null; avatar?: string | null } | null>
  | { uid: string; displayName?: string | null; avatar?: string | null }
  | null

export type AuthRoutesConfig = {
  /** 门面地址与密钥；缺省读 env AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET */
  authServer?: { url?: string; secret?: string; org?: string }
  /** 微信小程序通道；缺省读 env WEAPP_APPID / WEAPP_SECRET（未配 → /api/auth/weapp 返 404） */
  weapp?: { appId?: string; appSecret?: string; timeoutMs?: number }
  session: {
    /**
     * 会话签名密钥（deploy 注入，如 SESSION_SECRET）。
     * 可传函数则每次请求重新取值；取值时为空 = 缺配，fail-closed 返 503「会话密钥未配置」。
     * 完全不传（undefined）= 装配错误，抛 TypeError。
     */
    secret: string | (() => string)
    /** 会话 TTL（秒）；缺省 172800（48h） */
    ttlSec?: number
    /** 会话 cookie 名；缺省 app_session */
    cookieName?: string
  }
  /** 锚定器类型；缺省 'identity' */
  anchor?: 'identity' | 'allowlist' | 'first-login'
  /** anchor=allowlist 时必填：白名单 openid 所在 env 键名 */
  anchorEnv?: string | null
  /** openid → 本站 uid；anchor=allowlist 且省略时 uid 即 openid */
  resolveIdentity?: ResolveIdentity
  /** 登录成功时回给前端的 user 形状（缺省 { id, displayName, avatar }） */
  userPayload?: (id: string, displayName?: string | null, avatar?: string | null) => unknown
  /**
   * env 访问器：缺省 `process.env`；可传对象或 `(key) => value`（换运行时可注入，不读全局 env）。
   * 注意：核心仍经 `node:crypto` 签会话，**运行时限 Node**；Edge/CF 需自备签名。
   */
  env?: Record<string, string | undefined> | ((key: string) => string | undefined)
}

export type AuthRoutes = {
  /** POST /api/auth/sso-verify：微信内静默登录（票根 → openid → 锚定 → 会话 cookie） */
  ssoVerify: (req: Request) => Promise<Response>
  /** GET /api/auth/wx-qrcode：PC 扫码取码（透传门面） */
  wxQrcode: (req?: Request) => Promise<Response>
  /** GET /api/auth/wx-poll?scene=：PC 扫码轮询（非终态原样透传；仅 ok 签会话） */
  wxPoll: (req: Request) => Promise<Response>
  /**
   * POST /api/auth/weapp：小程序登录（`Taro.login` code → jscode2session → resolveIdentity → 签会话）。
   * 返回 `{ ok:true, token, maxAgeSec, user }`（weapp 无 cookie，故用 token）。
   */
  weappVerify: (req: Request) => Promise<Response>
  /** POST /api/auth/logout：清会话 cookie */
  logout: (req?: Request) => Promise<Response>
  /** PC 扫码通道是否已配置（登录页能力探测用） */
  wxConfigured: () => boolean
  /** 通配分发：一个处理器覆盖 /api/auth/<action>（sso-verify|wx-qrcode|wx-poll|weapp|logout） */
  dispatch: (req: Request) => Promise<Response>
}

/**
 * 装配 auth 服务端核心（框架无关：处理器吃 Web `Request`、返 Web `Response`）。
 * @throws {TypeError} session.secret 未传 / anchor 非法 / anchor=allowlist 缺 anchorEnv
 */
export declare function createAuthServer(config: AuthRoutesConfig): AuthRoutes
