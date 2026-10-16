/**
 * server.mjs — auth 服务端「认人」核心（框架无关，Web Request → Response）
 *
 * 为什么存在：登录服务端的稳定部分（验票 introspect、取码、轮询、签会话、登出、小程序换码）
 * 原先只在 `@hxym18/auth/next` 里实现一次。Taro 站后端是 Hono（不是 Next），若各框架各写一份
 * 就会漂移。这里把**与框架无关的核心**抽出来，Next / Hono / 任意 Web 标准框架都薄包一层。
 *
 * 分工：**统一层认人，各站用人**。本文件只跑「票根/小程序 code → openid/unionid → 本站 uid → 会话」，
 * 各站唯一入口 = `resolveIdentity` 回调（openid → 本站 user）。
 *
 * 运行时：**Node**（内部经 node.mjs 的 HMAC 签会话，依赖 node:crypto）。框架无关 ≠ 运行时无关；
 * Edge / Cloudflare 等无 node:crypto 的运行时需自备签名，不能直接引本模块。
 * env 契约（缺省从 process.env 读，可显式覆写或注入 env）：AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET /
 * AUTH_ISSUE_ORG / WEAPP_APPID / WEAPP_SECRET / NODE_ENV。
 */
import { APP_SESSION_COOKIE, SESSION_TTL_SEC, isTicket, renewIfStale, resolveSessionSecure, LEGACY_HEX_RE, authErrorCode } from './core.mjs'
import { callAuthServer, exchangeWeappCode, issueSession, readCookieValue, readSession, SESSION_UID_RE } from './node.mjs'

/** 统一 no-store（票根/会话响应一律不可缓存） */
const NO_STORE = { 'cache-control': 'no-store' }
/** PC 扫码 scene 形态：`ssologin-` + 24 位 hex（与 auth-server 发出侧严格同款） */
const SCENE_RE = /^ssologin-[a-f0-9]{24}$/
/** 锚定器枚举（identity=身份锚 / allowlist=白名单 / first-login=首登） */
export const ANCHORS = ['identity', 'allowlist', 'first-login']

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
  })
}

/** 会话 cookie 头（httpOnly；**默认恒 `Secure`**，仅非生产可显式关；Path=/；SameSite=Lax——与各站存量写法逐字一致） */
function sessionCookieHeader(name, value, maxAgeSec, secure) {
  return `${name}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAgeSec}`
}

/**
 * 从请求读会话（「认人」的最后一环，站点中间件用）：
 * 依次取 cookie（`cookieName`，缺省 `app_session`）或 `Authorization: Bearer <值>`，验签 → `{ uid, iat }`。
 * 无效/缺失 → null（不抛错）。与 `createAuthServer` 的投递方式（cookie / token / both）配对。
 * @param {Request} req
 * @param {{ secret?: string, cookieName?: string, ttlSec?: number }} opts
 *        ttlSec 透传给 `readSession` 做绝对过期判定（缺省 172800=48h）
 * @returns {{ uid: string, iat: number } | null}
 */
export function getSession(req, opts) {
  const o = opts || {}
  const secret = o.secret
  const cookieName = o.cookieName || APP_SESSION_COOKIE
  if (typeof secret !== 'string' || !secret || !req || !req.headers) return null
  let value = readCookieValue(req.headers.get('cookie') || '', cookieName)
  if (!value) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '')
    if (m) value = m[1].trim()
  }
  if (!value) return null
  return readSession(value, { secret, ttlSec: o.ttlSec })
}

/**
 * 会话读取器（**Node-only**：验签/重签经 node.mjs 依赖 `node:crypto`）。
 *
 * 为什么存在：各站 `lib/auth.ts` 的会话胶水（审计 A1/A2/A3）是同一骨架逐字复制——
 *   ① 读 `app_session` → 验签 → 按 uid 查本站用户；过续期点则静默重签写回（滑动续期）
 *   ② 迁移期双读旧 64hex cookie（`wi_session`/`fang_session`）→ 查本站 `sessions` 表 → 命中即升级写新名
 * 本工厂把骨架收进包：站点只交 `loadUser`（本站查库）与 `legacyCookies`（本站旧 cookie 名）；
 * cookie 名（`app_session`）、TTL、legacy 64hex 判定、静默续期、升级写新名全部单源。
 *
 * 出口分层：**Edge middleware 只从 `@hxym18/auth/core` 取 `LEGACY_*` 常量**做格式粗判，不引本函数
 * （本函数含 node 密码学，Edge 不可载）。
 *
 * @param {{
 *   secret: string | (() => string),
 *   ttlSec?: number,
 *   cookieName?: string,
 *   legacyCookies?: string[],
 *   loadUser: (idOrToken: string, info: { kind: 'session' | 'legacy', source?: string }) => unknown | Promise<unknown>,
 *   secure?: boolean,
 *   env?: Record<string, string | undefined> | ((key: string) => string | undefined),
 * }} config
 *        secret 必填（可传函数按请求取值）；ttlSec 缺省 172800（48h），须与签发侧同值；
 *        cookieName 缺省 `app_session`；legacyCookies = 站点私有旧 cookie 名（与统一会话同名/空串自动忽略）；
 *        loadUser(idOrToken, {kind,source}) 是**唯一业务回调**（kind='session' 收 uid，kind='legacy'
 *        收 64hex token，source=命中的 cookie 名），返回 `{ id }` 形状的本站用户或 null；
 *        secure/env 与 `renewSession` 同口径（`Secure` 决策单一来源 `core.resolveSessionSecure`）。
 * @returns {{ read: (req: Request) => Promise<object | null>, renew: (req: Request) => Promise<Response | null> }}
 *        `read`：读会话 → 用户 | null（无副作用）。`renew`：需续期/升级时返带 `Set-Cookie` 的
 *        `Response`（**仅 Node**），否则 null。`read` 与 `renew` 各自独立解析（同请求同时调用会各查一次 `loadUser`）。
 */
export function createSessionReader(config) {
  const cfg = config || {}
  const cookieName = cfg.cookieName || APP_SESSION_COOKIE
  const ttlRaw = cfg.ttlSec != null ? Number(cfg.ttlSec) : SESSION_TTL_SEC
  const ttlSec = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : SESSION_TTL_SEC
  // 与 createAuthServer 的 session.legacyCookies 同口径：去空、去与统一会话同名者。
  const legacyCookies = Array.isArray(cfg.legacyCookies)
    ? cfg.legacyCookies.filter((n) => typeof n === 'string' && n.trim() && n !== cookieName)
    : []
  const loadUser = typeof cfg.loadUser === 'function' ? cfg.loadUser : null
  const secretOf = () => (typeof cfg.secret === 'function' ? cfg.secret() : cfg.secret)
  const envSource = cfg.env != null ? cfg.env : typeof process !== 'undefined' ? process.env : undefined
  const envGet = (k) => {
    const v = typeof envSource === 'function' ? envSource(k) : envSource ? envSource[k] : undefined
    return v == null ? '' : String(v)
  }

  /** 解析当前请求会话：新会话优先（验签 + loadUser），否则迁移期旧 cookie（64hex + loadUser）。 */
  async function resolve(req) {
    const secret = secretOf()
    if (typeof secret !== 'string' || !secret || !req || !req.headers) return null
    const cookieHeader = req.headers.get('cookie') || ''
    const appValue = readCookieValue(cookieHeader, cookieName)
    const session = readSession(appValue, { secret, ttlSec })
    if (session) {
      const user = loadUser ? await loadUser(session.uid, { kind: 'session' }) : null
      // 与站点存量一致：新会话有效但用户不存在 → 不返回，继续回落 legacy 双读。
      if (user) return { user, uid: session.uid, iat: session.iat, fromLegacy: false }
    }
    for (const name of legacyCookies) {
      const token = readCookieValue(cookieHeader, name)
      if (!token || !LEGACY_HEX_RE.test(token)) continue
      const user = loadUser ? await loadUser(token, { kind: 'legacy', source: name }) : null
      // 升级需给合法 uid 签新会话（uid 契约同 issueSession）；用户形状不符则视作未命中。
      if (user && typeof user.id === 'string' && SESSION_UID_RE.test(user.id)) {
        return { user, uid: user.id, iat: null, fromLegacy: true }
      }
    }
    return null
  }

  async function read(req) {
    const r = await resolve(req)
    return r ? r.user : null
  }

  async function renew(req) {
    const r = await resolve(req)
    if (!r) return null
    // 新会话：仅过续期点才滑动续期；legacy 命中：无条件升级写新名（同站点存量 refreshSessionCookie）。
    if (!r.fromLegacy && !renewIfStale(r.iat, { ttlSec })) return null
    const secret = secretOf()
    if (typeof secret !== 'string' || !secret) return null
    const { value, maxAgeSec } = issueSession(r.uid, { secret, ttlSec })
    // Secure 决策与签发侧 createAuthServer / 续期侧 renewSession 共用 core.resolveSessionSecure（单一口径）。
    const secure = resolveSessionSecure(envGet, cfg.secure)
    const res = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
    res.headers.append('set-cookie', sessionCookieHeader(cookieName, value, maxAgeSec, secure))
    return res
  }

  return { read, renew }
}

/**
 * 门面配置：显式给值优先（含显式空串=未配置），未给才回落 env。
 * 按请求解析（不装配期冻结）——env 是运行期注入的，装配期往往读不到。
 */
function authServerConf(over, envGet) {
  const o = over || {}
  const pick = (key, envKey) => (o[key] !== undefined ? o[key] : envGet(envKey))
  return { url: pick('url', 'AUTH_INTERNAL_URL'), secret: pick('secret', 'AUTH_INTERNAL_SECRET'), org: pick('org', 'AUTH_ISSUE_ORG') }
}

/** 小程序通道配置：显式给值优先，未给回落 env（WEAPP_APPID / WEAPP_SECRET） */
function weappConf(over, envGet) {
  const o = over || {}
  const pick = (key, envKey) => (o[key] !== undefined ? o[key] : envGet(envKey))
  return { appId: pick('appId', 'WEAPP_APPID'), appSecret: pick('appSecret', 'WEAPP_SECRET'), timeoutMs: o.timeoutMs }
}

/**
 * 认人（票根 → openid）——调 auth-server 统一出口 /api/auth/introspect。
 * 返回 `{ok:true, openid}`（openid=null 即票根无效/过期）或 `{ok:false, kind}`：
 *   'not_configured' 门面未配置 · 'misconfig' 密钥不符（部署问题，不是用户问题）· 'unavailable' 通道故障
 */
async function introspectTicket(conf, ticket) {
  const r = await callAuthServer(conf.url, '/api/auth/introspect', { ticket }, { secret: conf.secret })
  if (r.ok) {
    const openid = typeof r.data.openid === 'string' && r.data.openid ? r.data.openid : null
    // unionid-ready：门面若返回 unionid 就透传（未绑开放平台/未升级门面时为 null，不阻塞登录）
    const unionid = typeof r.data.unionid === 'string' && r.data.unionid ? r.data.unionid : null
    return { ok: true, openid, unionid }
  }
  if (r.error === 'not_configured') return { ok: false, kind: 'not_configured' }
  if (r.error === 'http_401') return { ok: false, kind: 'misconfig' }
  return { ok: false, kind: 'unavailable' }
}

/** 认人失败 → 对外的响应（文案与各站存量保持一致，用户侧读得懂）。
 *  形状由装配期的 `errorShape` 决定，故经 `errorJson` 出口（模块级函数拿不到闭包，按参数注入）。 */
function introspectFailure(kind, errorJson) {
  if (kind === 'not_configured') return errorJson(503, 'SSO 通道未配置')
  if (kind === 'misconfig') return errorJson(500, '登录通道配置异常')
  return errorJson(503, '登录服务暂时不可用，请稍后再试')
}

/**
 * 装配 auth 服务端核心（框架无关：处理器吃 Web `Request`、返 Web `Response`）。
 *
 * @param {{
 *   authServer?: { url?: string, secret?: string, org?: string },
 *   weapp?: { appId?: string, appSecret?: string, timeoutMs?: number },
 *   session: { secret: string | (() => string), ttlSec?: number, cookieName?: string, secure?: boolean },
 *   anchor?: 'identity'|'allowlist'|'first-login',
 *   anchorEnv?: string | null,
 *   resolveIdentity?: (openid: string, ctx: { source: 'sso'|'qr'|'weapp', nickname?: string|null, avatar?: string|null, unionid?: string|null }) => Promise<{ uid: string, isNew?: boolean, displayName?: string|null, avatar?: string|null }|null> | { uid: string, isNew?: boolean, displayName?: string|null, avatar?: string|null } | null,
 *        **非 allowlist 锚定必填**（缺则装配抛 TypeError）；返回的 `uid` 须匹配 `^[A-Za-z0-9_-]{8,64}$`（openid 不作公开 id）。
 *   onFirstLogin?: (ctx: { uid: string, source: 'sso'|'qr'|'weapp', openid: string, unionid: string|null }) => Promise<void>|void,
 *   loadProfile?: (uid: string) => Promise<{ displayName?: string|null, avatar?: string|null }|null> | { displayName?: string|null, avatar?: string|null } | null,
 *   userPayload?: (id: string, displayName?: string|null, avatar?: string|null) => unknown,
 *   errorShape?: 'error' | 'code-message',
 *        'error'（缺省）：`{ ok:false, error:'<中文文案>' }`；
 *        'code-message' ：`{ ok:false, code:'<稳定码>', message:'<中文文案>' }`（码表见 core.AUTH_ERROR_CODES）。
 *        非法值抛 TypeError。
 *   env?: Record<string, string | undefined> | ((key: string) => string | undefined)
 * }} config
 */
export function createAuthServer(config) {
  const cfg = config || {}
  const session = cfg.session || {}
  if (session.secret == null) throw new TypeError('createAuthServer: session.secret is required')
  const anchor = cfg.anchor || 'identity'
  if (!ANCHORS.includes(anchor)) throw new TypeError(`createAuthServer: 未知 anchor「${anchor}」`)
  const anchorEnv = cfg.anchorEnv || null
  if (anchor === 'allowlist' && !anchorEnv) {
    throw new TypeError('createAuthServer: anchor=allowlist 必须声明 anchorEnv（白名单 env 键名）')
  }
  /** 首登钩子：`resolveIdentity` 标记 `isNew:true` 时调用一次（核心无状态，不存首登记录）。 */
  const onFirstLogin = typeof cfg.onFirstLogin === 'function' ? cfg.onFirstLogin : null
  if (anchor === 'first-login' && !onFirstLogin) {
    throw new TypeError('createAuthServer: anchor=first-login 必须提供 onFirstLogin 钩子')
  }
  const cookieName = session.cookieName || APP_SESSION_COOKIE
  const ttlSec = session.ttlSec || SESSION_TTL_SEC
  /**
   * 会话投递方式：
   *   'cookie'（缺省，向后兼容 Next 站）：Set-Cookie。
   *   'token' ：响应带 `{ token }`，不设 cookie——供「Bearer 到处用」的站（如 Taro/Hono token 模型）。
   *   'both'  ：既 Set-Cookie 也回 `{ token }`。
   * 验证侧用 `@hxym18/auth/node` 的 `readSession(value, { secret })`（cookie 值或 Bearer token 通用）。
   */
  const deliver = session.deliver || 'cookie'
  if (!['cookie', 'token', 'both'].includes(deliver)) {
    throw new TypeError(`createAuthServer: 未知 session.deliver「${deliver}」（cookie|token|both）`)
  }
  /**
   * 错误体形状（P-3）：
   *   'error'（缺省）：`{ ok:false, error:'<中文文案>' }`——存量站（fang/wordinput）按此读 `data.error`，逐字不变。
   *   'code-message' ：`{ ok:false, code:'<稳定码>', message:'<中文文案>' }`——站点按 `code` 分支，
   *                    不靠中文文案判类型（文案一改前端分支就断）。码表见 core.AUTH_ERROR_CODES。
   * 为什么做成配置而不是直接改默认：两站现读 `error`，硬切会断；站点「各站一致」靠**各站都选同一种**达成。
   */
  const errorShape = cfg.errorShape === undefined ? 'error' : cfg.errorShape
  if (errorShape !== 'error' && errorShape !== 'code-message') {
    throw new TypeError(`createAuthServer: 未知 errorShape「${errorShape}」（error|code-message）`)
  }
  /** 错误体对象（`extra` 为站点附加字段，如 allowlist 的 `configured`）。 */
  const errorBody = (status, message, extra) =>
    errorShape === 'code-message'
      ? { ok: false, code: authErrorCode(status), message, ...(extra || {}) }
      : { ok: false, error: message, ...(extra || {}) }
  /** 错误响应（唯一出口，一处决定形状）。 */
  const errorJson = (status, message, extra) => json(errorBody(status, message, extra), status)
  /**
   * 会话密钥按请求取值：允许传函数，则每次请求重新读 env。
   * 密钥是「运行期才注入」的环境变量，装配期往往读不到；缺配按 fail-closed 返 503，不签任何会话。
   */
  const secretOf = () => (typeof session.secret === 'function' ? session.secret() : session.secret)
  // 会话 cookie `Secure`（S6 硬化，单一口径见 core.resolveSessionSecure）：默认恒 `Secure`（不看 `NODE_ENV`）；
  // 仅显式 `session.secure === false` 且当前非生产才关（本地 http 开发）；生产里显式关无效（fail-closed）。
  // 按请求解析（env 注入后可能变化），与续期侧 `renewSession` 同口径。
  /**
   * env 访问器：默认 process.env；可注入对象或 `(key) => value`（换运行时可注入，不读全局 env）。
   * 注意：核心仍经 node:crypto 签会话，运行时限 Node；Edge/CF 需自备签名。
   */
  const envSource = cfg.env || process.env
  const envGet = (k) => {
    const v = typeof envSource === 'function' ? envSource(k) : envSource[k]
    return v == null ? '' : String(v)
  }
  // 门面/小程序配置**按请求**解析（不装配期冻结），与 session.secret 口径一致。
  const confOf = () => authServerConf(cfg.authServer, envGet)
  const resolveIdentity = cfg.resolveIdentity || null

  /**
   * 迁移期 legacy 会话 cookie 名（站点**声明**，如 `['wi_session']`）：登出时一并清。
   * 站点私有的过渡 cookie（名字/是否销 DB 行各站不同）不该由共享包猜，也不该让每站复制一层路由。
   */
  const legacyCookies = Array.isArray(session.legacyCookies)
    ? session.legacyCookies.filter((n) => typeof n === 'string' && n.trim() && n !== cookieName)
    : []
  /**
   * 站点登出钩子（扩展点，与 `onFirstLogin` 对称）：返回额外的 `Set-Cookie` 头数组（原样追加）。
   * 典型用途：迁称期旧会话要销本站 `sessions` 行——`onLogout(ctx)` 里读 `ctx.req` 的旧 cookie 再删。
   */
  const onLogout = typeof cfg.onLogout === 'function' ? cfg.onLogout : null
  /** 清 cookie 头：Path/HttpOnly/SameSite/Secure 与签发侧同口径（浏览器按名字+Path+Domain 匹配，Secure 仅随环境） */
  const clearCookie = (name) =>
    `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${resolveSessionSecure(envGet, session.secure) ? '; Secure' : ''}`
  /**
   * 非 allowlist 锚定必须提供 `resolveIdentity`：否则 uid 会退化为 openid，
   * 违反「openid 不作公开 id（除 allowlist）」（S6）。allowlist 站可省——uid 即白名单 openid。
   */
  if (anchor !== 'allowlist' && !resolveIdentity) {
    throw new TypeError(
      'createAuthServer: 非 allowlist 锚定必须提供 resolveIdentity（openid → 本站 uid；uid 须匹配 ^[A-Za-z0-9_-]{8,64}$）',
    )
  }
  /** 可选：登录后按 uid 读回本站资料（昵称/头像）——weapp 端借此继承 H5 资料，站点无需再写读回。 */
  const loadProfile = cfg.loadProfile || null
  const userPayload = cfg.userPayload || ((id, displayName, avatar) => ({ id, displayName: displayName || null, avatar: avatar || null }))

  /** 403 响应体（不在准入名单）。allowlist 站额外带 `configured` 区分「没配名单」与「不在名单」。 */
  function deniedBody() {
    const extra =
      anchor === 'allowlist'
        ? { configured: Boolean(String(envGet(anchorEnv)).trim()) && Boolean(secretOf()) }
        : undefined
    return errorBody(403, '没有访问权限', extra)
  }

  /** 准入判定 → uid：白名单锚定在工厂内做（声明式），其余交各站 resolveIdentity（唯一业务入口） */
  async function admit(openid, source, profile) {
    // 注意：白名单比的是 openid；weapp 传入的是「小程序 openid」（≠ SSO openid），故 allowlist 站会拒 weapp。
    // 若将来 allowlist 站需小程序登录，应改比 `profile.unionid ?? openid`。
    if (anchor === 'allowlist') {
      const allowed = String(envGet(anchorEnv)).trim()
      if (!allowed || openid !== allowed) return null
    }
    if (resolveIdentity) {
      const ident = await resolveIdentity(openid, {
        source,
        nickname: (profile && profile.nickname) || null,
        avatar: (profile && profile.avatar) || null,
        unionid: (profile && profile.unionid) || null,
      })
      if (!ident || !ident.uid) return null
      return {
        uid: String(ident.uid),
        displayName: ident.displayName ?? null,
        avatar: ident.avatar ?? null,
        // 新用户标记（可选）：站点 resolveIdentity 判定「首次登录」时置 true，核心据此触发 onFirstLogin。
        isNew: ident.isNew === true,
      }
    }
    // 无 resolveIdentity：仅 allowlist 站可到此（装配已强制非 allowlist 必配 resolveIdentity），
    // uid 即白名单 openid（openid 作公开 id 仅在 allowlist 场景允许）。
    return { uid: openid, displayName: null, avatar: null, isNew: false }
  }

  /**
   * 锚定 + 签会话（不落 Set-Cookie，返回会话值），供各流程复用：
   *   - H5/SSO/扫码 → 由调用方塞进 `Set-Cookie`（见 `issue`）
   *   - 小程序 weapp → 由调用方作为 JSON `token` 返回（weapp 无 cookie）
   * 返回 `{ ok:true, uid, displayName, avatar, value, maxAgeSec, user }` 或 `{ ok:false, status, body }`。
   */
  /**
   * 给**已知 uid** 签会话（不锚定）：校验 uid 形态与密钥 → issueSession → 读回资料。
   * 锚定流程（`resolveAndIssue`）与 dev-login 共用的尾部。
   * 返回 `{ ok:true, uid, displayName, avatar, value, maxAgeSec, user }` 或 `{ ok:false, status, body }`。
   */
  async function signForUid(uid, displayName, avatar) {
    if (typeof uid !== 'string' || !SESSION_UID_RE.test(uid)) {
      return { ok: false, status: 500, body: errorBody(500, '身份锚定异常') }
    }
    const secret = secretOf()
    if (!secret) return { ok: false, status: 503, body: errorBody(503, '会话密钥未配置') }
    const { value, maxAgeSec } = issueSession(uid, { secret, ttlSec })
    // 读回本站资料（若配 loadProfile）：未给的字段用站点已存资料补齐（weapp 继承 H5）。
    let dn = displayName ?? null
    let av = avatar ?? null
    if (loadProfile) {
      try {
        const p = await loadProfile(uid)
        if (p) {
          if (dn == null && p.displayName != null) dn = p.displayName
          if (av == null && p.avatar != null) av = p.avatar
        }
      } catch {
        /* 降级：读资料失败不阻塞登录 */
      }
    }
    return { ok: true, uid, displayName: dn, avatar: av, value, maxAgeSec, user: userPayload(uid, dn, av) }
  }

  async function resolveAndIssue(openid, source, profile) {
    const ident = await admit(openid, source, profile)
    if (!ident) return { ok: false, status: 403, body: deniedBody() }
    const r = await signForUid(ident.uid, ident.displayName, ident.avatar)
    // first-login：站点标记新用户 → 登录成功后调一次 onFirstLogin（异常降级，不阻塞登录）。
    if (r.ok && ident.isNew && onFirstLogin) {
      try {
        await onFirstLogin({ uid: r.uid, source, openid, unionid: (profile && profile.unionid) || null })
      } catch {
        /* 降级：首登后处理失败不阻塞登录 */
      }
    }
    return r
  }

  /** 按 `deliver`（cookie / token / both）投递已签会话；`extra` 并入响应体。 */
  function deliverSession(r, extra) {
    const body = { ok: true, ...(extra || {}), user: r.user }
    if (deliver !== 'cookie') body.token = r.value
    const res = json(body)
    if (deliver !== 'token') {
      // Secure 决策与续期侧（node.mjs renewSession）共用 core.resolveSessionSecure 同一口径：
      // 默认恒 Secure；仅显式 session.secure===false 且非生产才关；生产里显式关无效（fail-closed）。
      const secure = resolveSessionSecure(envGet, session.secure)
      res.headers.append('set-cookie', sessionCookieHeader(cookieName, r.value, r.maxAgeSec, secure))
    }
    return res
  }

  /** 认人成功后的收尾：锚定 + 签会话 + 按 `deliver` 投递（cookie / token / both）。 */
  async function issue(openid, source, extra, profile) {
    const r = await resolveAndIssue(openid, source, profile)
    if (!r.ok) return json(r.body, r.status)
    return deliverSession(r, extra)
  }

  /* ---------------- 微信内静默登录（SSO 验票）---------------- */
  async function handleSsoVerify(req) {
    const conf = confOf()
    const body = await req.json().catch(() => null)
    // 宽容入参：统一契约为 {ticket}，同时接受存量各站的 {webSession}
    const ticket = String((body && (body.ticket || body.webSession)) || '').trim()
    if (!isTicket(ticket)) return errorJson(401, '无效票根')
    const r = await introspectTicket(conf, ticket)
    if (!r.ok) return introspectFailure(r.kind, errorJson)
    if (!r.openid) return errorJson(401, '会话无效或已过期')
    // 尽力补资料：门面池里有昵称/头像就带给 resolveIdentity（独立端点，introspect 契约不动）。
    // **不拿 org 当开关（P-9）**：门面契约里 org 缺省即回落 `defaultOrg()`（`casdoor-registry.readProfile`
    // 的 `orgAllowed(org) ? org : defaultOrg()`）——「不传 org」是它明确支持的路径。
    // 原先 `if (conf.org)` 把「站点没配 AUTH_ISSUE_ORG」错译成「没有资料可读」→ 昵称/头像永远 null、
    // 用户永远叫「微信用户」，而接口全绿（静默劣化线上数据）。org 现在只在有值时传。
    let profile = null
    if (conf.url && conf.secret) {
      try {
        const pr = await callAuthServer(
          conf.url,
          '/api/auth/profile',
          conf.org ? { ticket, org: conf.org } : { ticket },
          { secret: conf.secret },
        )
        if (pr.ok && pr.data && typeof pr.data.profile === 'object' && pr.data.profile) profile = pr.data.profile
      } catch {
        /* 降级：无资料 */
      }
    }
    return issue(r.openid, 'sso', undefined, {
      nickname: (profile && profile.nickname) || null,
      avatar: (profile && profile.avatar) || null,
      unionid: r.unionid,
    })
  }

  /* ---------------- PC 扫码：取码 / 轮询 ---------------- */
  /** 取码。anchor=allowlist 必须走「手机端显式确认」（confirm 标记原样透传）。 */
  async function handleWxQrcode() {
    const conf = confOf()
    if (!conf.url || !conf.secret) return errorJson(503, '微信登录暂未开通')
    const payload = {
      action: 'issue',
      ...(conf.org ? { org: conf.org } : {}),
      ...(anchor === 'allowlist' ? { confirm: true } : {}),
    }
    const r = await callAuthServer(conf.url, '/api/auth/qr/issue', payload, { secret: conf.secret })
    if (!r.ok || !r.data.scene) return errorJson(502, '二维码获取失败，请稍后再试')
    return json({
      ok: true,
      scene: r.data.scene,
      qrUrl: r.data.qrUrl,
      expiresIn: r.data.expiresIn,
      ...(typeof r.data.pairCode === 'string' && r.data.pairCode ? { pairCode: r.data.pairCode } : {}),
      ...(r.data.confirm === true ? { confirm: true } : {}),
    })
  }

  /** 轮询。非终态一律原样透传 status —— 尤其 `pending`（已扫码、等确认）：绝不并进 waiting、绝不当终态。 */
  async function handleWxPoll(req) {
    const conf = confOf()
    if (!conf.url || !conf.secret) return errorJson(503, '微信登录暂未开通')
    const scene = new URL(req.url).searchParams.get('scene') || ''
    if (!SCENE_RE.test(scene)) return errorJson(400, 'scene 无效')
    const r = await callAuthServer(conf.url, '/api/auth/qr/poll', { action: 'poll', scene }, { secret: conf.secret })
    if (!r.ok) return errorJson(502, '查询失败，请稍后再试')
    if (r.data.status !== 'ok') return json({ ok: true, status: r.data.status })
    if (!r.data.openid) return errorJson(502, '登录数据异常，请重试')
    return issue(String(r.data.openid), 'qr', { status: 'ok' }, {
      nickname: r.data.nickname || null,
      avatar: r.data.avatar || null,
      unionid: typeof r.data.unionid === 'string' && r.data.unionid ? r.data.unionid : null,
    })
  }

  /* ---------------- 微信小程序（weapp）：换码 → 锚定 → 签 token ---------------- */
  /**
   * 小程序登录：`Taro.login` 的 code → `jscode2session`（共享换码，含 unionid）→ resolveIdentity → 签会话。
   * 返回 JSON `{ ok:true, token, maxAgeSec, user }`（weapp 无 cookie，故用 token）；站点无需自写锚定。
   */
  async function handleWeappVerify(req) {
    const weapp = weappConf(cfg.weapp, envGet)
    const body = await req.json().catch(() => null)
    const code = String((body && body.code) || '').trim()
    const r = await exchangeWeappCode({ code, appId: weapp.appId, appSecret: weapp.appSecret, timeoutMs: weapp.timeoutMs })
    if (!r.ok) {
      if (r.error === 'not_configured') return errorJson(404, '小程序登录未启用')
      if (r.error === 'bad_code' || r.error === 'invalid_code') return errorJson(401, '登录凭证无效，请重试')
      return errorJson(502, '微信登录服务暂时不可用，请稍后再试')
    }
    const issued = await resolveAndIssue(r.openid, 'weapp', { nickname: null, avatar: null, unionid: r.unionid })
    if (!issued.ok) return json(issued.body, issued.status)
    return json({ ok: true, token: issued.value, maxAgeSec: issued.maxAgeSec, user: issued.user })
  }

  /* ---------------- 登出 ---------------- */

  /**
   * 登出：清统一会话 cookie；**迁移期**额外清站点声明的 legacy cookie（`session.legacyCookies`）
   * 并调用站点 `onLogout(ctx)` 钩子（返回的 Set-Cookie 头原样追加）。
   *
   * **未登录返 401（P-2）**：请求带不出任何会话凭据时，不该假装成功（站点侧「登出未登录」应可区分）。
   * 但**清 cookie 与 `onLogout` 一律照做**——陈旧 cookie 必须能被清掉，迁移期旧会话行也必须能销。
   * 「已登录」的判定 = 有效统一会话（cookie 或 `Authorization: Bearer`）**或**任一已声明的 legacy cookie
   * （谁是真会话由站点私有实现决定，共享包只认「这个声明过的名字在不在」）。
   * 不传 `req`（服务端直调）时无从判定登录态 → 维持 200，只做「清 cookie」这件事。
   *
   * 为什么是扩展点而不是每站包一层 `[action]`：legacy cookie（`wi_session`/`fang_session` 等）
   * 是**站点私有**的过渡产物（名字与是否需要销 DB 行各站不同），共享包无从知道；把它做成声明 + 钩子
   * 后，站点只声明，不再复制「包一层只对 logout 追加 Set-Cookie」的路由代码。
   */
  async function handleLogout(req) {
    const sess = req ? getSession(req, { secret: secretOf(), cookieName, ttlSec }) : null
    const cookieHeader = req ? req.headers.get('cookie') || '' : ''
    const hasLegacy = Boolean(req) && legacyCookies.some((name) => Boolean(readCookieValue(cookieHeader, name)))
    const res = !req || sess || hasLegacy ? json({ ok: true }) : errorJson(401, '请先登录')
    res.headers.append('set-cookie', clearCookie(cookieName))
    // 迁移期 legacy cookie：声明即清（同一 Path=/；Secure 与统一会话同口径）
    for (const name of legacyCookies) res.headers.append('set-cookie', clearCookie(name))
    if (onLogout) {
      try {
        const extra = await onLogout({ req })
        for (const header of Array.isArray(extra) ? extra : []) {
          if (typeof header === 'string' && header) res.headers.append('set-cookie', header)
        }
      } catch {
        // 钩子失败不阻断登出：统一会话 cookie 已清（浏览器侧已登出）；站点侧残留按站点自行告警
      }
    }
    return res
  }

  /* ---------------- 能力探测 / 开发旁路（config + dev-login）---------------- */

  /** PC 扫码通道是否已配置（登录页「能力探测」用） */
  function wxConfigured() {
    const conf = confOf()
    return Boolean(conf.url && conf.secret)
  }

  /**
   * dev-login 三重 fail-closed 门（任一不满足即不启用）：
   *   ① 显式非生产：`NODE_ENV` **必须存在（非空）且 ≠ 'production'**——
   *      缺失/空一律视为关闭（fail-closed；防生产漏设 `NODE_ENV` 时旁路误开）；
   *   ② 显式 flag：`AUTH_DEV_LOGIN` 为真值（缺省/''/'0'/'false' 一律视为关）；
   *   ③ uid 白名单非空：`AUTH_DEV_UID`（逗号分隔）。
   * 返回 `{ open, allow }`；`allow` = 去空白后的白名单 uid 数组。
   */
  function devGate() {
    const rawFlag = String(envGet('AUTH_DEV_LOGIN')).trim().toLowerCase()
    const flag = rawFlag !== '' && rawFlag !== '0' && rawFlag !== 'false'
    const allow = String(envGet('AUTH_DEV_UID'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const ne = envGet('NODE_ENV')
    const nonProd = ne !== '' && ne !== 'production'
    return { open: nonProd && flag && allow.length > 0, allow }
  }

  /** GET /api/auth/config：登录页能力探测——wxEnabled=扫码通道配好否；devLogin=三重门是否开启。 */
  function handleConfig() {
    return json({ ok: true, wxEnabled: wxConfigured(), devLogin: devGate().open })
  }

  /**
   * POST /api/auth/dev-login：开发旁路登录（仅三重门全开时）。
   * 直接给**白名单内的 uid** 签会话——不经过 `resolveIdentity`：dev uid 不是 openid，
   * 站点锚定无从映射（若走锚定，配了 resolveIdentity 的站会 403，旁路失效）。
   * 门未开 → 404（对未启用者不暴露端点存在）。请求体可选 `{ uid }` 指定白名单内某个 uid；
   * 省略且白名单恰一个时用该 uid，否则 404。
   */
  async function handleDevLogin(req) {
    const { open, allow } = devGate()
    if (!open) return errorJson(404, 'not_found')
    const body = await req.json().catch(() => null)
    const requested = body && typeof body.uid === 'string' && body.uid.trim() ? body.uid.trim() : ''
    const uid = requested || (allow.length === 1 ? allow[0] : '')
    if (!uid || !allow.includes(uid)) return errorJson(404, 'not_found')
    const r = await signForUid(uid, null, null)
    if (!r.ok) return json(r.body, r.status)
    return deliverSession(r, undefined)
  }

  return {
    ssoVerify: handleSsoVerify,
    wxQrcode: handleWxQrcode,
    wxPoll: handleWxPoll,
    weappVerify: handleWeappVerify,
    logout: (req) => handleLogout(req),
    /** GET /api/auth/config：能力探测（`{ ok:true, wxEnabled, devLogin }`） */
    config: handleConfig,
    /** POST /api/auth/dev-login：开发旁路登录（三重门全开才 200，否则 404） */
    devLogin: handleDevLogin,
    /** PC 扫码通道是否已配置（登录页「能力探测」用：/api/auth/config 报给前端） */
    wxConfigured,
    /**
     * 通配分发（单文件建全部端点）：`/api/auth/<action>`。
     * action 按**固定前缀 `/api/auth/` 剥离后取首段**（不用 `split('/').pop()`）——
     * 兼容尾斜杠（`/api/auth/config/`）与多段路径（`/api/auth/foo/bar` → action='foo'）。
     */
    async dispatch(req) {
      const p = new URL(req.url).pathname.replace(/\/$/, '')
      const action = p.startsWith('/api/auth/') ? p.slice('/api/auth/'.length).split('/')[0] : ''
      const method = req.method.toUpperCase()
      if (action === 'config' && method === 'GET') return handleConfig()
      if (action === 'dev-login' && method === 'POST') return handleDevLogin(req)
      if (action === 'sso-verify' && method === 'POST') return handleSsoVerify(req)
      if (action === 'wx-qrcode' && method === 'GET') return handleWxQrcode()
      if (action === 'wx-poll' && method === 'GET') return handleWxPoll(req)
      if (action === 'weapp' && method === 'POST') return handleWeappVerify(req)
      if (action === 'logout' && method === 'POST') return handleLogout(req)
      return errorJson(404, 'not_found')
    },
  }
}
