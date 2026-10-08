/** 锚定器枚举（与 app.json 的 auth.anchor 声明、docs/platform-standards.md §3 同口径） */
export declare const ANCHORS: readonly string[]

/** 身份锚定回调：openid → 本站 uid（各站「怎么用这个人」的唯一入口） */
export type ResolveIdentity = (
  openid: string,
  ctx: {
    source: 'sso' | 'qr'
    /** 扫码通道拿到的微信昵称（静默通道/没拿到为 null） */
    nickname: string | null
    /** 登录链路顺手拿到的微信头像 URL（没拿到为 null；2026-09-30 头像昵称批） */
    avatar: string | null
  },
) =>
  | Promise<{ uid: string; displayName?: string | null } | null>
  | { uid: string; displayName?: string | null }
  | null

export type AuthRoutesConfig = {
  /** 门面地址与密钥；缺省读 env AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET */
  authServer?: { url?: string; secret?: string }
  session: {
    /**
     * 会话签名密钥（deploy 注入，如 SESSION_SECRET）。
     * 可传函数则每次请求重新取值（密钥是运行期 env，构建/装配期往往读不到）；
     * 取值时为空 = 缺配，fail-closed 返 503「会话密钥未配置」，不签任何会话。
     * 完全不传（undefined）= 装配错误，抛 TypeError。
     */
    secret: string | (() => string)
    /** 会话 TTL（秒）；缺省 172800（@app/auth SESSION_TTL_SEC） */
    ttlSec?: number
    /** 会话 cookie 名；缺省 app_session（@app/auth APP_SESSION_COOKIE） */
    cookieName?: string
  }
  /** 锚定器类型；缺省 'identity' */
  anchor?: 'identity' | 'allowlist' | 'first-login'
  /** anchor=allowlist 时必填：白名单 openid 所在 env 键名（值由 deploy 注入） */
  anchorEnv?: string | null
  /** openid → 本站 uid；anchor=allowlist 且省略时 uid 即 openid */
  resolveIdentity?: ResolveIdentity
  /** 登录成功时回给前端的 user 形状（缺省 { id, displayName }） */
  userPayload?: (id: string, displayName?: string | null) => unknown
}

export type AuthRoutes = {
  /** POST /api/auth/sso-verify：微信内静默登录（票根 → openid → 锚定 → 会话 cookie） */
  ssoVerify: (req: Request) => Promise<Response>
  /**
   * GET /api/auth/wx-qrcode：PC 扫码取码（透传 auth-server）。
   * anchor=allowlist 的站自动带 confirm 走「手机端确认步」，响应多一个 `confirm:true` 标记
   * （非 allowlist 站不带该键，响应形状不变）——前端/巡检据此识别本站是否走确认。
   */
  wxQrcode: (req: Request) => Promise<Response>
  /**
   * GET /api/auth/wx-poll?scene=：PC 扫码轮询。
   * 非终态 `status` 原样透传（`waiting` 未扫 / `pending` 已扫等手机端点确认 / `expired`）；
   * 只有 `ok` 才锚定并签发会话 cookie（`pending` 绝不算登录成功，前端须继续轮询）。
   */
  wxPoll: (req: Request) => Promise<Response>
  /** POST /api/auth/logout：清会话 cookie */
  logout: (req: Request) => Promise<Response>
  /** PC 扫码通道是否已配置（登录页能力探测用） */
  wxConfigured: () => boolean
  /** 通配分发：一个 route.ts 覆盖 /api/auth/<action>（sso-verify|wx-qrcode|wx-poll|logout） */
  dispatch: (req: Request) => Promise<Response>
}

/**
 * 装配 auth 路由（Node runtime；内部用 @app/auth/node 的 HMAC 签会话）。
 * @throws {TypeError} session.secret 未传 / anchor 非法 / anchor=allowlist 缺 anchorEnv
 */
export declare function createAuthRoutes(config: AuthRoutesConfig): AuthRoutes