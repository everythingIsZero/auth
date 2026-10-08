/**
 * controller.mjs — 框架无关登录控制器（零框架依赖，可在浏览器 / Taro / 测试里跑）
 *
 * 为什么存在：登录动线（按端分流、SSO 跳转与回跳消费、PC 取码轮询、手机配对码、dev-login）
 * 原先在 wordinput / fang / nuantie 各写了一份（150–200 行/站），差异只在 JSX。
 * 本层承接全部**状态与流程**，只把「平台能力」（cookie/导航/定时器/请求）通过 adapter/api 注入；
 * 各站与框架适配层只负责渲染。
 *
 * 平台差异全部走注入：
 *   - adapter：readCookie / currentUrl / replaceUrl / navigate / setTimeout / clearTimeout
 *   - api：config / qrcode / poll / verify / devLogin（浏览器可造 createFetchApi；Taro 用 Taro.request）
 *   - caps：能力位（建议由 `@hxym18/env` 计算后注入），控制器不自判 UA。
 *
 * 状态机（server poll 契约：waiting | pending | ok | expired）：
 *   idle → waiting（出码）→ pending（已扫码待确认）→ ok（登录成功）
 *   expired（自动换新码）；接口异常按重试间隔续轮，不判死。
 */
import { AUTH_ORIGIN, SSO_TICKET_COOKIE, isTicket } from './core.mjs'

const DEFAULT_URLS = Object.freeze({
  qrcode: '/api/auth/wx-qrcode',
  poll: '/api/auth/wx-poll',
  verify: '/api/auth/sso-verify',
  config: '/api/auth/config',
  devLogin: '/api/auth/dev-login',
})

/**
 * 造浏览器 fetch 版 api（站点同源相对路径）。Taro 侧请自备（Taro.request）。
 * @param {{ fetchImpl?: typeof fetch, qrcodeUrl?: string, pollUrl?: string, verifyUrl?: string, configUrl?: string, devLoginUrl?: string }} [opts]
 */
export function createFetchApi(opts) {
  const o = opts || {}
  const f = o.fetchImpl || globalThis.fetch
  const urls = {
    qrcode: o.qrcodeUrl || DEFAULT_URLS.qrcode,
    poll: o.pollUrl || DEFAULT_URLS.poll,
    verify: o.verifyUrl || DEFAULT_URLS.verify,
    config: o.configUrl || DEFAULT_URLS.config,
    devLogin: o.devLoginUrl || DEFAULT_URLS.devLogin,
  }
  const get = (url) =>
    f(url, { cache: 'no-store' }).then((r) => r.json().catch(() => ({})))
  const post = (url, body) =>
    f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store',
    }).then((r) => r.json().catch(() => ({})))

  return {
    qrcode: () => get(urls.qrcode),
    poll: (scene) => get(`${urls.poll}?scene=${encodeURIComponent(scene)}`),
    verify: (body) => post(urls.verify, body),
    config: () => get(urls.config),
    devLogin: () => post(urls.devLogin, {}),
  }
}

/**
 * @param {{
 *   adapter: { readCookie: (name: string) => string, currentUrl: () => string, replaceUrl: (url: string) => void, navigate: (url: string) => void, setTimeout: (fn: Function, ms: number) => any, clearTimeout: (id: any) => void },
 *   api: { config: Function, qrcode: Function, poll: Function, verify: Function, devLogin: Function },
 *   caps?: { isWechat?: boolean, isMobile?: boolean },
 *   authOrigin?: string,
 *   cookieName?: string,
 *   pollIntervalMs?: number,
 *   retryIntervalMs?: number,
 *   onSuccess?: (data: any) => void,
 *   onState?: (state: any) => void
 * }} opts
 */
export function createLoginController(opts) {
  const o = opts || {}
  const adapter = o.adapter
  const api = o.api
  if (!adapter) throw new TypeError('createLoginController: adapter is required')
  if (!api) throw new TypeError('createLoginController: api is required')

  const authOrigin = (o.authOrigin || AUTH_ORIGIN).replace(/\/+$/, '')
  const cookieName = o.cookieName || SSO_TICKET_COOKIE
  const caps = o.caps || {}
  const pollIntervalMs = o.pollIntervalMs || 3000
  const retryIntervalMs = o.retryIntervalMs || 5000
  const onSuccess = o.onSuccess || (() => {})
  const onState = o.onState || (() => {})

  const channel = caps.isWechat ? 'wechat' : caps.isMobile ? 'mobile' : 'pc'
  let disposed = false
  let timer = null
  let scene = ''
  let state = {
    channel,
    status: 'idle', // idle | waiting | pending | ok | error | verifying
    qrUrl: '',
    pairCode: '',
    error: '',
    wxEnabled: null,
    devLogin: false,
    user: null,
  }

  function setState(patch) {
    state = { ...state, ...patch }
    if (!disposed) onState(state)
  }

  function clearTimer() {
    if (timer != null) {
      adapter.clearTimeout(timer)
      timer = null
    }
  }

  function schedule(fn, ms) {
    clearTimer()
    timer = adapter.setTimeout(fn, ms)
  }

  /** 出码 → 轮询。expired 自动换新码；接口异常按重试间隔续轮。 */
  async function startQr() {
    if (disposed) return
    setState({ status: 'waiting', error: '' })
    let d
    try {
      d = await api.qrcode()
    } catch (e) {
      if (!disposed) setState({ status: 'error', error: (e && e.message) || '二维码获取失败' })
      return
    }
    if (disposed) return
    if (!d || !d.ok || !d.scene) {
      setState({ status: 'error', error: (d && d.error) || '二维码获取失败' })
      return
    }
    scene = d.scene
    setState({
      status: 'waiting',
      qrUrl: d.qrUrl || '',
      pairCode: typeof d.pairCode === 'string' ? d.pairCode : '',
    })
    poll()
  }

  async function poll() {
    if (disposed || !scene) return
    let d
    try {
      d = await api.poll(scene)
    } catch {
      if (!disposed) schedule(poll, retryIntervalMs)
      return
    }
    if (disposed) return
    if (d && d.ok && d.status === 'ok') {
      scene = ''
      setState({ status: 'ok', qrUrl: '', user: (d && d.user) || null })
      onSuccess(d)
      return
    }
    if (d && d.ok && d.status === 'pending') {
      setState({ status: 'pending' })
      schedule(poll, pollIntervalMs)
      return
    }
    if (d && d.ok && d.status === 'expired') {
      startQr()
      return
    }
    if (d && d.ok) {
      setState({ status: 'waiting' })
      schedule(poll, pollIntervalMs)
      return
    }
    // 接口异常（502/400 等）：不静默死亡，续轮自愈
    schedule(poll, retryIntervalMs)
  }

  /** 挂载即调用：消费 ?sso=return 回跳（微信内静默登录）。返回是否登录成功。 */
  async function consumeReturn() {
    let url
    try {
      url = new URL(adapter.currentUrl())
    } catch {
      return false
    }
    if (url.searchParams.get('sso') !== 'return') return false
    url.searchParams.delete('sso')
    try {
      adapter.replaceUrl(url.toString())
    } catch {
      /* ignore */
    }
    const ticket = adapter.readCookie(cookieName)
    if (!isTicket(ticket)) return false
    setState({ status: 'verifying', error: '' })
    try {
      const d = await api.verify({ ticket })
      if (disposed) return false
      if (d && d.ok) {
        setState({ status: 'ok', user: (d && d.user) || null })
        onSuccess(d)
        return true
      }
    } catch {
      /* 通道故障：静默，不误判为已登录 */
    }
    if (!disposed) setState({ status: 'idle' })
    return false
  }

  /** 微信内置浏览器：整页跳 auth 站静默授权，回跳带 sso=return。 */
  function startSso() {
    let target
    try {
      const u = new URL(adapter.currentUrl())
      u.searchParams.set('sso', 'return')
      target = u.toString()
    } catch {
      target = ''
    }
    adapter.navigate(`${authOrigin}/?redirect=${encodeURIComponent(target)}`)
  }

  /** PC/手机：拉配置（判断扫码通道是否开通）后出码。微信内不自动取码。 */
  async function start() {
    if (channel === 'wechat') {
      setState({ status: 'idle' })
      return
    }
    let cfg = null
    let cfgErr = false
    try {
      cfg = await api.config()
    } catch {
      cfgErr = true
    }
    if (disposed) return
    if (cfgErr || !cfg) {
      setState({ status: 'error', error: '配置拉取失败，请重试' })
      return
    }
    setState({ wxEnabled: !!cfg.wxEnabled, devLogin: !!cfg.devLogin })
    if (!cfg.wxEnabled) {
      setState({ status: 'error', error: '微信登录暂未开通' })
      return
    }
    await startQr()
  }

  async function devLogin() {
    setState({ error: '' })
    let d
    try {
      d = await api.devLogin()
    } catch (e) {
      if (!disposed) setState({ status: 'error', error: (e && e.message) || '开发旁路登录失败' })
      return false
    }
    if (d && d.ok) {
      setState({ status: 'ok', user: (d && d.user) || null })
      onSuccess(d)
      return true
    }
    if (disposed) return false
    setState({ status: 'error', error: (d && d.error) || '开发旁路登录失败' })
    return false
  }

  return {
    getState: () => state,
    consumeReturn,
    start,
    startSso,
    /** 重新走一遍（含 config 开关门），用于错误重试按钮 */
    refresh: async () => {
      if (disposed) return
      await start()
    },
    devLogin,
    dispose: () => {
      disposed = true
      clearTimer()
    },
  }
}

/**
 * 把浏览器 window 归一到控制器 adapter。可在无 DOM 的测试里传假 window。
 * @param {any} win
 */
export function browserAdapter(win) {
  const w = win || globalThis
  const doc = w.document || {}
  return {
    readCookie(name) {
      const raw = typeof doc.cookie === 'string' ? doc.cookie : ''
      const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
      return m ? decodeURIComponent(m[1]) : ''
    },
    currentUrl: () => (w.location && w.location.href) || '',
    replaceUrl(url) {
      if (w.history && typeof w.history.replaceState === 'function') {
        try {
          w.history.replaceState(null, '', url)
          return
        } catch {
          /* 隐私模式等：回退到直接赋值 */
        }
      }
      if (w.location) w.location.href = url
    },
    navigate(url) {
      if (w.location && typeof w.location.assign === 'function') {
        w.location.assign(url)
        return
      }
      if (w.location) w.location.href = url
    },
    setTimeout: (fn, ms) => w.setTimeout(fn, ms),
    clearTimeout: (id) => w.clearTimeout(id),
  }
}

/**
 * Taro 适配。H5 端委托 window；小程序端（无全域 cookie / 网页跳转）保持惰性——
 * 读不到票根、不跳转、不抛错，登录由各小程序身份源自行处理。
 * @param {any} Taro
 * @param {{ isH5?: boolean, win?: any }} [opts]
 */
export function taroAdapter(Taro, opts) {
  const o = opts || {}
  if (o.isH5) return browserAdapter(o.win || globalThis)
  return {
    readCookie: () => '',
    currentUrl: () => '',
    replaceUrl: () => {},
    navigate: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  }
}
