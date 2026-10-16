/**
 * server.d.ts — auth 服务端「认人」核心的类型（框架无关）
 */

/** 锚定器枚举（identity=身份锚 / allowlist=白名单 / first-login=首登） */
export declare const ANCHORS: readonly string[]

/**
 * 身份锚定回调：openid → 本站 uid（各站「怎么用这个人」的唯一入口）。
 * **非 `allowlist` 锚定必填**（缺则装配抛 `TypeError`）；返回的 `uid` 须匹配
 * `/^[A-Za-z0-9_-]{8,64}$/`（字母数字 + `-`/`_`，8..64）——`openid` 不作公开 id（除 `allowlist`），
 * 故站点须映射为本站 uid，不得直接回传微信 openid。
 */
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
  | Promise<{
      uid: string
      /** 新用户标记（可选）：站点判定「首次登录」时置 true，核心据此触发 `onFirstLogin`。核心无状态，不存首登记录。 */
      isNew?: boolean
      displayName?: string | null
      avatar?: string | null
    } | null>
  | { uid: string; isNew?: boolean; displayName?: string | null; avatar?: string | null }
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
    /**
     * 会话投递方式：'cookie'（缺省，Set-Cookie）| 'token'（响应带 token，供 Bearer 模型）| 'both'。
     * 验证侧用 `@hxym18/auth/node` 的 `readSession(value, { secret })`。
     */
    deliver?: 'cookie' | 'token' | 'both'
    /**
     * 会话 cookie `Secure`（S6 硬化）。**缺省恒 `true`，不看 `NODE_ENV`**——生产路径不可能漏 `Secure`。
     * 仅显式 `false` 且当前非生产（`env.NODE_ENV !== 'production'`）才关，供**本地 http 开发**；
     * 生产里显式 `false` **无效**（fail-closed 仍 `true`）。本地开发请用此开关，**不要靠 `NODE_ENV` 推断**。
     * 与续期侧 `renewSession` 的 `secure` 同一口径。
     */
    secure?: boolean
    /**
     * **迁移期** legacy 会话 cookie 名（站点声明，如 `['wi_session']`）：`logout` 时**一并清**。
     * 站点私有的过渡 cookie 不该由共享包猜、也不该让每站复制一层 `[action]` 路由（与 `onFirstLogin` 对称的扩展点）。
     * 与统一会话同名者自动忽略；清 cookie 头与签发侧同 Path/HttpOnly/SameSite，`Secure` 随环境同口径。
     */
    legacyCookies?: string[]
  }
  /** 锚定器类型；缺省 'identity' */
  anchor?: 'identity' | 'allowlist' | 'first-login'
  /** anchor=allowlist 时必填：白名单 openid 所在 env 键名 */
  anchorEnv?: string | null
  /**
   * openid → 本站 uid；返回 uid 须匹配 `/^[A-Za-z0-9_-]{8,64}$/`。
   * **非 `allowlist` 锚定必填**（缺则装配抛 `TypeError`）；`allowlist` 站可省略——uid 即白名单 openid。
   */
  resolveIdentity?: ResolveIdentity
  /**
   * 首登钩子：`resolveIdentity` 返回 `isNew:true` 且登录成功时**调用一次**（`{ uid, source, openid, unionid }`）。
   * 站点据此做建号后处理 / 发欢迎 / 授默认权限。**核心无状态、不存首登记录、不比对本地库**——
   * 「是否首次」全由 `resolveIdentity` 的 `isNew` 判定。钩子异常**降级，不阻塞登录**。
   * `anchor:'first-login'` 时**必填**（缺则装配抛 `TypeError`）。
   */
  onFirstLogin?: (ctx: {
    uid: string
    source: 'sso' | 'qr' | 'weapp'
    openid: string
    unionid: string | null
  }) => Promise<void> | void
  /**
   * 登出钩子（扩展点）：返回额外的 `Set-Cookie` 头数组（原样追加到 `logout` 响应）。
   * 典型用途：迁移期旧会话要销本站 `sessions` 行——在 `ctx.req` 上读旧 cookie 再删。
   * 钩子异常**降级，不阻塞登出**（统一会话 cookie 已清）。`session.legacyCookies` 是它的声明式简写。
   */
  onLogout?: (ctx: { req?: Request }) => Promise<string[] | void> | string[] | void
  /** 登录后按 uid 读回本站资料（昵称/头像）——weapp 端借此继承 H5 资料 */
  loadProfile?: (
    uid: string,
  ) =>
    | Promise<{ displayName?: string | null; avatar?: string | null } | null>
    | { displayName?: string | null; avatar?: string | null }
    | null
  /** 登录成功时回给前端的 user 形状（缺省 { id, displayName, avatar }） */
  userPayload?: (id: string, displayName?: string | null, avatar?: string | null) => unknown
  /**
   * 错误体形状（P-3）。缺省 `'error'` = `{ ok:false, error:'<中文文案>' }`（存量站按此读 `data.error`，逐字不变）；
   * `'code-message'` = `{ ok:false, code:'<稳定码>', message:'<中文文案>' }`，站点按 `code` 分支、不靠文案。
   * 码表见 `@hxym18/auth/core` 的 `AUTH_ERROR_CODES` / `authErrorCode(status)`。非法值抛 `TypeError`。
   */
  errorShape?: 'error' | 'code-message'
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
  /**
   * POST /api/auth/logout：清会话 cookie。
   * **未登录（无有效会话且无已声明 legacy cookie）→ 401**（P-2），但仍清 cookie 并调 `onLogout`；
   * 不传 `req` 的服务端直调维持 200。错误体形状随 `errorShape`。
   */
  logout: (req?: Request) => Promise<Response>
  /** GET /api/auth/config：能力探测 → `{ ok:true, wxEnabled, devLogin }`（devLogin=三重门是否开启） */
  config: () => Promise<Response>
  /**
   * POST /api/auth/dev-login：开发旁路登录。
   * 三重 fail-closed 门（`NODE_ENV!=='production'` + `AUTH_DEV_LOGIN` 真值 + `AUTH_DEV_UID` 白名单非空）
   * 全开才签发会话（给白名单内 uid）；否则 404。
   */
  devLogin: (req: Request) => Promise<Response>
  /** PC 扫码通道是否已配置（登录页能力探测用） */
  wxConfigured: () => boolean
  /**
   * 通配分发：一个处理器覆盖 `/api/auth/<action>`
   * （config|dev-login|sso-verify|wx-qrcode|wx-poll|weapp|logout）。
   * action 按固定前缀 `/api/auth/` 剥离取首段，兼容尾斜杠/多段。
   */
  dispatch: (req: Request) => Promise<Response>
}

/**
 * 装配 auth 服务端核心（框架无关：处理器吃 Web `Request`、返 Web `Response`）。
 * @throws {TypeError} session.secret 未传 / anchor 非法 / anchor=allowlist 缺 anchorEnv / anchor=first-login 缺 onFirstLogin / 非 allowlist 缺 resolveIdentity
 */
export declare function createAuthServer(config: AuthRoutesConfig): AuthRoutes

/**
 * 从请求读会话（cookie 或 `Authorization: Bearer`）→ `{ uid, iat }`；无效/缺失 → null。
 * 与 `createAuthServer` 的 `session.deliver`（cookie/token/both）配对，站点中间件用。
 */
export declare function getSession(
  req: Request,
  opts: { secret?: string; cookieName?: string; ttlSec?: number }
): { uid: string; iat: number } | null

/** `loadUser` 回调的解析来源：`session`=新统一会话（收 uid）；`legacy`=迁移期旧 64hex cookie（收 token）。 */
export interface LoadUserInfo {
  kind: 'session' | 'legacy'
  /** kind='legacy' 时命中的旧 cookie 名（如 'wi_session'） */
  source?: string
}

/**
 * 会话读取器的业务回调（**唯一**）：`idOrToken` → 本站用户（须含 `id`）或 null。
 * `kind='session'` 时入参为新会话 uid；`kind='legacy'` 时入参为 64hex token（查本站 `sessions` 表）。
 */
export type LoadUser = (
  idOrToken: string,
  info: LoadUserInfo,
) => Promise<{ id: string } & Record<string, unknown> | null> | ({ id: string } & Record<string, unknown>) | null

export interface SessionReaderConfig {
  /** 会话签名密钥；可传函数按请求取值。缺失 → `read`/`renew` 均 null（fail-closed）。 */
  secret: string | (() => string)
  /** 会话 TTL（秒），缺省 172800（48h）；须与签发侧 `session.ttlSec` 同值 */
  ttlSec?: number
  /** 统一会话 cookie 名，缺省 `app_session` */
  cookieName?: string
  /** 迁移期旧 cookie 名（站点声明，如 `['fang_session']`）；与统一会话同名/空串自动忽略 */
  legacyCookies?: string[]
  /** 本站查库回调（唯一业务入口） */
  loadUser: LoadUser
  /** 与 `renewSession` 同口径：缺省恒 `true`，仅显式 `false` 且非生产才关 */
  secure?: boolean
  /** env 访问器：缺省 `process.env`；与签发侧 `createAuthServer` 的 `env` 同口径 */
  env?: Record<string, string | undefined> | ((key: string) => string | undefined)
}

export interface SessionReader {
  /** 读会话：新会话验签 + `loadUser(uid,{kind:'session'})`，否则回落旧 64hex cookie；无效/缺失 → null（无副作用） */
  read: (req: Request) => Promise<Record<string, unknown> | null>
  /**
   * 续期/升级（**Node-only**）：新会话过续期点（`renewIfStale`）或 legacy 命中 → 返带 `Set-Cookie` 的 200
   * `Response`；否则 null。`Secure` 决策与签发侧同源（`core.resolveSessionSecure`）。
   */
  renew: (req: Request) => Promise<Response | null>
}

/**
 * 会话读取器（**Node-only**：验签/重签经 `node:crypto`）。收敛各站 `lib/auth.ts` 会话胶水（审计 A1/A2/A3）：
 * cookie 名、TTL、legacy 64hex 判定、静默续期、legacy 升级写新名单源；站点只交 `loadUser` 与 `legacyCookies`。
 * **Edge middleware 不可引本函数**——只从 `@hxym18/auth/core` 取 `LEGACY_*` 常量做格式粗判。
 */
export declare function createSessionReader(config: SessionReaderConfig): SessionReader
