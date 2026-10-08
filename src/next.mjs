/**
 * next.mjs — Next.js 侧 auth 路由装配工厂（2026-09-16 SSO 配置驱动批 U1）
 *
 * 为什么：fang / wordinput / admin / ka 各自复制了 6~8 个 auth route（sso-verify / wx-qrcode /
 * wx-poll / logout …），加一个项目就要再抄一遍。这里把「稳定不变的部分」装配成现成 handler，
 * 各站只留「本项目怎么用这个人」（身份锚定）一行回调——即分工：统一层认人，各站用人。
 *
 * 服务端运行（Next Route Handler 默认 Node runtime，内部用 node.mjs 的 HMAC 签会话；
 * 需 Edge runtime 的消费方请自备签名，本工厂不适用）。
 *
 * 各站最小接入（写法见 docs/sso-login-spec.md「新站接入」）：
 *   // src/app/api/auth/[action]/route.ts —— 一个文件覆盖全部 auth 端点
 *   import { createAuthRoutes } from '@app/auth/next'
 *   const routes = createAuthRoutes({ session: { secret: process.env.SESSION_SECRET! }, ... })
 *   export const GET = routes.get
 *   export const POST = routes.post
 *
 * env 契约（缺省从 process.env 读，可显式覆写）：AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET
 * 身份锚定由 app.json 的 auth 段声明（mode / anchor / anchorEnv，单源=各 app.json）——
 * 禁在代码里按站名分支。
 */
import { APP_SESSION_COOKIE, SESSION_TTL_SEC, isTicket } from './core.mjs'
import { callAuthServer, issueSession } from './node.mjs'

/** 统一 no-store（票根/会话响应一律不可缓存） */
const NO_STORE = { 'cache-control': 'no-store' }
/** PC 扫码 scene 形态：`ssologin-` + 24 位 hex（与 auth-server 发出侧严格同款） */
const SCENE_RE = /^ssologin-[a-f0-9]{24}$/
/** 锚定器枚举（与 docs/platform-standards.md §3 的声明口径一致） */
export const ANCHORS = ['identity', 'allowlist', 'first-login']

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
  })
}

/** 会话 cookie 头（httpOnly；生产 Secure；Path=/；SameSite=Lax——与各站存量写法逐字一致） */
function sessionCookieHeader(name, value, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  return `${name}=${value}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAgeSec}`
}

/**
 * 门面配置：显式给值优先（含显式空串=未配置），未给才回落 env（AUTH_INTERNAL_URL / AUTH_INTERNAL_SECRET）。
 * 显式空串必须能表达「本站不接此通道」，否则总会漏到 env 上。
 */
function authServerConf(over) {
  const o = over || {}
  const pick = (key, envKey) => (o[key] !== undefined ? o[key] : process.env[envKey] || '')
  // org：本站登录身份在统一身份池（Casdoor）中的登记组织；空 = 不带 org（门面不登记）。
  // 仅 wordinput 试点带该标识（AUTH_ISSUE_ORG），fang/admin 未配置则请求形状与存量完全一致。
  return { url: pick('url', 'AUTH_INTERNAL_URL'), secret: pick('secret', 'AUTH_INTERNAL_SECRET'), org: pick('org', 'AUTH_ISSUE_ORG') }
}

/**
 * 认人（票根 → openid）——调 auth-server 统一出口 /api/auth/introspect。
 * 返回 `{ok:true, openid}`（openid=null 即票根无效/过期）或 `{ok:false, kind}`：
 *   'not_configured' 门面未配置 · 'misconfig' 密钥不符（部署问题，不是用户问题）· 'unavailable' 通道故障
 * 三态分开的原因：前两者不该清用户会话，通道故障要提示重试（详见 auth-server 端点注释）。
 */
async function introspectTicket(conf, ticket) {
  const r = await callAuthServer(conf.url, '/api/auth/introspect', { ticket }, { secret: conf.secret })
  if (r.ok) {
    const openid = typeof r.data.openid === 'string' && r.data.openid ? r.data.openid : null
    return { ok: true, openid }
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
 * 装配 auth 路由。
 *
 * @param {{
 *   authServer?: { url?: string, secret?: string },
 *   session: { secret: string | (() => string), ttlSec?: number, cookieName?: string },
 *   anchor?: 'identity'|'allowlist'|'first-login',
 *   anchorEnv?: string | null,
 *   resolveIdentity?: (openid: string, ctx: { source: 'sso'|'qr', nickname?: string|null, avatar?: string|null }) => Promise<{ uid: string, displayName?: string|null, avatar?: string|null }|null> | { uid: string, displayName?: string|null, avatar?: string|null } | null,
 *   userPayload?: (id: string, displayName?: string|null, avatar?: string|null) => unknown
 * }} config
 */
export function createAuthRoutes(config) {
  const cfg = config || {}
  const session = cfg.session || {}
  if (session.secret == null) throw new TypeError('createAuthRoutes: session.secret is required')
  const anchor = cfg.anchor || 'identity'
  if (!ANCHORS.includes(anchor)) throw new TypeError(`createAuthRoutes: 未知 anchor「${anchor}」`)
  const anchorEnv = cfg.anchorEnv || null
  if (anchor === 'allowlist' && !anchorEnv) {
    throw new TypeError('createAuthRoutes: anchor=allowlist 必须声明 anchorEnv（白名单 env 键名）')
  }
  const cookieName = session.cookieName || APP_SESSION_COOKIE
  const ttlSec = session.ttlSec || SESSION_TTL_SEC
  /**
   * 会话密钥按请求取值：允许传函数，则每次请求重新读 env。
   * 为什么：密钥是「运行期才注入」的环境变量，装配期（模块加载 / 构建期）往往读不到；
   * 若在装配期硬读并抛错，缺配会把 route 打成 500 / 拖垮构建，用户看不到可解释的提示。
   * 缺配属部署故障，按 fail-closed 处理——当前请求返 503「会话密钥未配置」，不签任何会话。
   */
  const secretOf = () => (typeof session.secret === 'function' ? session.secret() : session.secret)
  const conf = authServerConf(cfg.authServer)
  const resolveIdentity = cfg.resolveIdentity || null
  const userPayload = cfg.userPayload || ((id, displayName, avatar) => ({ id, displayName: displayName || null, avatar: avatar || null }))

  /**
   * 403 响应体（不在准入名单）。
   * allowlist 站额外带 `configured`：让登录页能分开说「服务端压根没配名单」与「你这个账号不在名单里」
   * ——两者对用户是两句不同的话（前者是部署故障，后者换账号即可）；其余锚定器没有这个歧义，不带。
   */
  function deniedBody() {
    const body = { ok: false, error: '没有访问权限' }
    if (anchor === 'allowlist') {
      body.configured = Boolean(String(process.env[anchorEnv] || '').trim()) && Boolean(secretOf())
    }
    return body
  }

  /** 准入判定 → uid：白名单锚定在工厂内做（声明式），其余交各站 resolveIdentity */
  async function admit(openid, source, profile) {
    if (anchor === 'allowlist') {
      const allowed = String(process.env[anchorEnv] || '').trim()
      if (!allowed || openid !== allowed) return null
    }
    if (resolveIdentity) {
      const ident = await resolveIdentity(openid, {
        source,
        nickname: (profile && profile.nickname) || null,
        avatar: (profile && profile.avatar) || null,
      })
      if (!ident || !ident.uid) return null
      return { uid: String(ident.uid), displayName: ident.displayName ?? null, avatar: ident.avatar ?? null }
    }
    // 无 resolveIdentity：uid 即 openid（admin 现状——白名单已在上一步把住）
    return { uid: openid, displayName: null, avatar: null }
  }

  /**
   * 认人成功后的收尾：锚定 + 签会话 + Set-Cookie。
   * 拒绝与故障分开说：不在准入名单 → 403（用户问题）；会话密钥缺配 → 503（部署问题）。
   */
  async function issue(openid, source, extra, profile) {
    const ident = await admit(openid, source, profile)
    if (!ident) return json(deniedBody(), 403)
    const secret = secretOf()
    if (!secret) return json({ ok: false, error: '会话密钥未配置' }, 503)
    const { value, maxAgeSec } = issueSession(ident.uid, { secret, ttlSec })
    const res = json({ ok: true, ...(extra || {}), user: userPayload(ident.uid, ident.displayName, ident.avatar) })
    res.headers.append('set-cookie', sessionCookieHeader(cookieName, value, maxAgeSec))
    return res
  }

  /* ---------------- 微信内静默登录（SSO 验票）---------------- */
  async function handleSsoVerify(req) {
    const body = await req.json().catch(() => null)
    // 宽容入参：统一契约为 {ticket}，同时接受存量各站的 {webSession}（渐进迁移，不必前后端同时改）
    const ticket = String((body && (body.ticket || body.webSession)) || '').trim()
    if (!isTicket(ticket)) return json({ ok: false, error: '无效票根' }, 401)
    const r = await introspectTicket(conf, ticket)
    if (!r.ok) return introspectFailure(r.kind)
    if (!r.openid) return json({ ok: false, error: '会话无效或已过期' }, 401)
    // 尽力补资料：门面池里有昵称/头像就带给 resolveIdentity（独立端点，introspect 契约不动）。
    // 仅 org 站启用（无 org 的站不登记身份池，问了也白问）；任何失败都降级为「无资料」，绝不阻塞登录。
    let profile = null
    if (conf.org) {
      try {
        const pr = await callAuthServer(
          conf.url,
          '/api/auth/profile',
          { ticket, org: conf.org },
          { secret: conf.secret }
        )
        if (pr.ok && pr.data && typeof pr.data.profile === 'object' && pr.data.profile) profile = pr.data.profile
      } catch {
        /* 降级：无资料 */
      }
    }
    return issue(r.openid, 'sso', undefined, {
      nickname: (profile && profile.nickname) || null,
      avatar: (profile && profile.avatar) || null,
    })
  }

  /* ---------------- PC 扫码：取码 / 轮询 ---------------- */
  /**
   * 取码。anchor=allowlist（管理后台）必须走「手机端显式确认」：
   * 任意人可匿名调本站取码接口拿真码 → 发给本人诱扫 → 微信内扫码只是静默 SCAN；
   * 没有确认步，攻击者轮询同一 scene 就换到本人的最高权限会话。
   * 判据走声明式 anchor（禁按站名分支），confirm 标记原样透传给前端/巡检。
   */
  async function handleWxQrcode() {
    if (!conf.url || !conf.secret) return json({ ok: false, error: '微信登录暂未开通' }, 503)
    const payload = {
      action: 'issue',
      // org：登录身份登记组织（仅试点站配置；未配置时请求形状与存量完全一致）
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
      // 6 位配对码（移动浏览器登录桥）：手机浏览器无法扫自己屏幕上的二维码，
      // 改引导用户把此码发给服务号；PC 分支忽略此字段。门面契约向后兼容（老门面不返回则无此键）
      ...(typeof r.data.pairCode === 'string' && r.data.pairCode ? { pairCode: r.data.pairCode } : {}),
      // 确认站另带 confirm:true（非确认站不带该键，响应形状不变）——「本站是否走确认」的机器可读判据
      ...(r.data.confirm === true ? { confirm: true } : {}),
    })
  }

  /**
   * 轮询。非终态一律原样透传 status —— 尤其 `pending`（已扫码、等手机端点确认）：
   * 既不能并进 waiting，也不能当终态吃掉，否则确认步在前端就不可见（用户不知道要去点）。
   */
  async function handleWxPoll(req) {
    if (!conf.url || !conf.secret) return json({ ok: false, error: '微信登录暂未开通' }, 503)
    const scene = new URL(req.url).searchParams.get('scene') || ''
    if (!SCENE_RE.test(scene)) return json({ ok: false, error: 'scene 无效' }, 400)
    const r = await callAuthServer(conf.url, '/api/auth/qr/poll', { action: 'poll', scene }, { secret: conf.secret })
    if (!r.ok) return json({ ok: false, error: '查询失败，请稍后再试' }, 502)
    // waiting / pending / expired 原样透传（只有 ok 才轮到锚定与签会话）
    if (r.data.status !== 'ok') return json({ ok: true, status: r.data.status })
    // 扫码完成但缺 openid = 通道数据异常，不锚定（防错号）
    if (!r.data.openid) return json({ ok: false, error: '登录数据异常，请重试' }, 502)
    return issue(String(r.data.openid), 'qr', { status: 'ok' }, {
      nickname: r.data.nickname || null,
      avatar: r.data.avatar || null,
    })
  }

  /* ---------------- 登出 ---------------- */
  async function handleLogout() {
    const res = json({ ok: true })
    res.headers.append('set-cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return res
  }

  /** 供 App Router 直接挂载：每站 route.ts 各 2~3 行 */
  return {
    ssoVerify: handleSsoVerify,
    wxQrcode: handleWxQrcode,
    wxPoll: handleWxPoll,
    logout: handleLogout,
    /** PC 扫码通道是否已配置（登录页「能力探测」用：/api/auth/config 报给前端） */
    wxConfigured: () => Boolean(conf.url && conf.secret),
    /** 通配分发（单文件建全部端点）：`/api/auth/<action>` */
    async dispatch(req) {
      const action = new URL(req.url).pathname.split('/').pop() || ''
      const method = req.method.toUpperCase()
      if (action === 'sso-verify' && method === 'POST') return handleSsoVerify(req)
      if (action === 'wx-qrcode' && method === 'GET') return handleWxQrcode()
      if (action === 'wx-poll' && method === 'GET') return handleWxPoll(req)
      if (action === 'logout' && method === 'POST') return handleLogout()
      return json({ ok: false, error: 'not_found' }, 404)
    },
  }
}