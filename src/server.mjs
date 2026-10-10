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
import { APP_SESSION_COOKIE, SESSION_TTL_SEC, isTicket } from './core.mjs'
import { callAuthServer, exchangeWeappCode, issueSession, SESSION_UID_RE } from './node.mjs'

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

/** 会话 cookie 头（httpOnly；生产 Secure；Path=/；SameSite=Lax——与各站存量写法逐字一致） */
function sessionCookieHeader(name, value, maxAgeSec, secure) {
  return `${name}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAgeSec}`
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

/** 认人失败 → 对外的响应（文案与各站存量保持一致，用户侧读得懂） */
function introspectFailure(kind) {
  if (kind === 'not_configured') return json({ ok: false, error: 'SSO 通道未配置' }, 503)
  if (kind === 'misconfig') return json({ ok: false, error: '登录通道配置异常' }, 500)
  return json({ ok: false, error: '登录服务暂时不可用，请稍后再试' }, 503)
}

/**
 * 装配 auth 服务端核心（框架无关：处理器吃 Web `Request`、返 Web `Response`）。
 *
 * @param {{
 *   authServer?: { url?: string, secret?: string, org?: string },
 *   weapp?: { appId?: string, appSecret?: string, timeoutMs?: number },
 *   session: { secret: string | (() => string), ttlSec?: number, cookieName?: string },
 *   anchor?: 'identity'|'allowlist'|'first-login',
 *   anchorEnv?: string | null,
 *   resolveIdentity?: (openid: string, ctx: { source: 'sso'|'qr'|'weapp', nickname?: string|null, avatar?: string|null, unionid?: string|null }) => Promise<{ uid: string, displayName?: string|null, avatar?: string|null }|null> | { uid: string, displayName?: string|null, avatar?: string|null } | null,
 *   userPayload?: (id: string, displayName?: string|null, avatar?: string|null) => unknown,
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
  const cookieName = session.cookieName || APP_SESSION_COOKIE
  const ttlSec = session.ttlSec || SESSION_TTL_SEC
  /**
   * 会话密钥按请求取值：允许传函数，则每次请求重新读 env。
   * 密钥是「运行期才注入」的环境变量，装配期往往读不到；缺配按 fail-closed 返 503，不签任何会话。
   */
  const secretOf = () => (typeof session.secret === 'function' ? session.secret() : session.secret)
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
  const userPayload = cfg.userPayload || ((id, displayName, avatar) => ({ id, displayName: displayName || null, avatar: avatar || null }))

  /** 403 响应体（不在准入名单）。allowlist 站额外带 `configured` 区分「没配名单」与「不在名单」。 */
  function deniedBody() {
    const body = { ok: false, error: '没有访问权限' }
    if (anchor === 'allowlist') {
      body.configured = Boolean(String(envGet(anchorEnv)).trim()) && Boolean(secretOf())
    }
    return body
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
      return { uid: String(ident.uid), displayName: ident.displayName ?? null, avatar: ident.avatar ?? null }
    }
    // 无 resolveIdentity：uid 即 openid（admin 现状——白名单已在上一步把住）
    return { uid: openid, displayName: null, avatar: null }
  }

  /**
   * 锚定 + 签会话（不落 Set-Cookie，返回会话值），供各流程复用：
   *   - H5/SSO/扫码 → 由调用方塞进 `Set-Cookie`（见 `issue`）
   *   - 小程序 weapp → 由调用方作为 JSON `token` 返回（weapp 无 cookie）
   * 返回 `{ ok:true, uid, displayName, avatar, value, maxAgeSec, user }` 或 `{ ok:false, status, body }`。
   */
  async function resolveAndIssue(openid, source, profile) {
    const ident = await admit(openid, source, profile)
    if (!ident) return { ok: false, status: 403, body: deniedBody() }
    if (typeof ident.uid !== 'string' || !SESSION_UID_RE.test(ident.uid)) {
      return { ok: false, status: 500, body: { ok: false, error: '身份锚定异常' } }
    }
    const secret = secretOf()
    if (!secret) return { ok: false, status: 503, body: { ok: false, error: '会话密钥未配置' } }
    const { value, maxAgeSec } = issueSession(ident.uid, { secret, ttlSec })
    return {
      ok: true,
      uid: ident.uid,
      displayName: ident.displayName,
      avatar: ident.avatar,
      value,
      maxAgeSec,
      user: userPayload(ident.uid, ident.displayName, ident.avatar),
    }
  }

  /** 认人成功后的收尾（cookie 通道）：锚定 + 签会话 + Set-Cookie。 */
  async function issue(openid, source, extra, profile) {
    const r = await resolveAndIssue(openid, source, profile)
    if (!r.ok) return json(r.body, r.status)
    const secure = envGet('NODE_ENV') === 'production'
    const res = json({ ok: true, ...(extra || {}), user: r.user })
    res.headers.append('set-cookie', sessionCookieHeader(cookieName, r.value, r.maxAgeSec, secure))
    return res
  }

  /* ---------------- 微信内静默登录（SSO 验票）---------------- */
  async function handleSsoVerify(req) {
    const conf = confOf()
    const body = await req.json().catch(() => null)
    // 宽容入参：统一契约为 {ticket}，同时接受存量各站的 {webSession}
    const ticket = String((body && (body.ticket || body.webSession)) || '').trim()
    if (!isTicket(ticket)) return json({ ok: false, error: '无效票根' }, 401)
    const r = await introspectTicket(conf, ticket)
    if (!r.ok) return introspectFailure(r.kind)
    if (!r.openid) return json({ ok: false, error: '会话无效或已过期' }, 401)
    // 尽力补资料：门面池里有昵称/头像就带给 resolveIdentity（独立端点，introspect 契约不动）。
    let profile = null
    if (conf.org) {
      try {
        const pr = await callAuthServer(conf.url, '/api/auth/profile', { ticket, org: conf.org }, { secret: conf.secret })
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
    if (!conf.url || !conf.secret) return json({ ok: false, error: '微信登录暂未开通' }, 503)
    const payload = {
      action: 'issue',
      ...(conf.org ? { org: conf.org } : {}),
      ...(anchor === 'allowlist' ? { confirm: true } : {}),
    }
    const r = await callAuthServer(conf.url, '/api/auth/qr/issue', payload, { secret: conf.secret })
    if (!r.ok || !r.data.scene) return json({ ok: false, error: '二维码获取失败，请稍后再试' }, 502)
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
    if (!conf.url || !conf.secret) return json({ ok: false, error: '微信登录暂未开通' }, 503)
    const scene = new URL(req.url).searchParams.get('scene') || ''
    if (!SCENE_RE.test(scene)) return json({ ok: false, error: 'scene 无效' }, 400)
    const r = await callAuthServer(conf.url, '/api/auth/qr/poll', { action: 'poll', scene }, { secret: conf.secret })
    if (!r.ok) return json({ ok: false, error: '查询失败，请稍后再试' }, 502)
    if (r.data.status !== 'ok') return json({ ok: true, status: r.data.status })
    if (!r.data.openid) return json({ ok: false, error: '登录数据异常，请重试' }, 502)
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
      if (r.error === 'not_configured') return json({ ok: false, error: '小程序登录未启用' }, 404)
      if (r.error === 'bad_code' || r.error === 'invalid_code') return json({ ok: false, error: '登录凭证无效，请重试' }, 401)
      return json({ ok: false, error: '微信登录服务暂时不可用，请稍后再试' }, 502)
    }
    const issued = await resolveAndIssue(r.openid, 'weapp', { nickname: null, avatar: null, unionid: r.unionid })
    if (!issued.ok) return json(issued.body, issued.status)
    return json({ ok: true, token: issued.value, maxAgeSec: issued.maxAgeSec, user: issued.user })
  }

  /* ---------------- 登出 ---------------- */
  async function handleLogout() {
    const res = json({ ok: true })
    res.headers.append('set-cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return res
  }

  return {
    ssoVerify: handleSsoVerify,
    wxQrcode: handleWxQrcode,
    wxPoll: handleWxPoll,
    weappVerify: handleWeappVerify,
    logout: handleLogout,
    /** PC 扫码通道是否已配置（登录页「能力探测」用：/api/auth/config 报给前端） */
    wxConfigured: () => {
      const conf = confOf()
      return Boolean(conf.url && conf.secret)
    },
    /** 通配分发（单文件建全部端点）：`/api/auth/<action>` */
    async dispatch(req) {
      const action = new URL(req.url).pathname.split('/').pop() || ''
      const method = req.method.toUpperCase()
      if (action === 'sso-verify' && method === 'POST') return handleSsoVerify(req)
      if (action === 'wx-qrcode' && method === 'GET') return handleWxQrcode()
      if (action === 'wx-poll' && method === 'GET') return handleWxPoll(req)
      if (action === 'weapp' && method === 'POST') return handleWeappVerify(req)
      if (action === 'logout' && method === 'POST') return handleLogout()
      return json({ ok: false, error: 'not_found' }, 404)
    },
  }
}
