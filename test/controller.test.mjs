/**
 * controller.test.mjs — 框架无关登录控制器（node:test，零依赖）
 * 覆盖：按端分流、PC/手机取码轮询（waiting/pending/ok/expired/故障续轮）、SSO 跳转、
 * ?sso=return 回跳消费、dev-login、dispose。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLoginController, createFetchApi } from '../src/controller.mjs'

const SCENE = 'ssologin-' + 'a'.repeat(24)
const TICKET = 'b'.repeat(48)

/** 测试台：假 adapter + 假 api，定时器手动驱动，完全确定性 */
function harness(over = {}) {
  const h = {
    url: over.url || 'https://ka.hxym18.com/',
    cookies: { ...(over.cookies || {}) },
    timers: [],
    navs: [],
    replaces: [],
    calls: { verify: [], qrcode: 0, poll: [], config: 0, devLogin: 0 },
    _seq: 1,
    _pollQueue: over.pollQueue ? [...over.pollQueue] : [{ ok: true, status: 'waiting' }],
  }
  h.adapter = {
    readCookie: (name) => h.cookies[name] || '',
    currentUrl: () => h.url,
    replaceUrl: (u) => {
      h.replaces.push(u)
      h.url = u
    },
    navigate: (u) => {
      h.navs.push(u)
      h.url = u
    },
    setTimeout: (fn, ms) => {
      const id = h._seq++
      h.timers.push({ id, fn, ms })
      return id
    },
    clearTimeout: (id) => {
      h.timers = h.timers.filter((t) => t.id !== id)
    },
  }
  h.api = {
    config: async () => {
      h.calls.config++
      return over.config === undefined ? { wxEnabled: true, devLogin: over.devLogin === true } : over.config
    },
    qrcode: async () => {
      h.calls.qrcode++
      return over.qrcode === undefined
        ? { ok: true, scene: SCENE, qrUrl: 'https://qr.example/' + h.calls.qrcode, expiresIn: 300, pairCode: over.pairCode }
        : over.qrcode
    },
    poll: async (scene) => {
      h.calls.poll.push(scene)
      if (h._pollQueue.length === 0) throw new Error('pollQueue exhausted')
      return h._pollQueue.shift()
    },
    verify: async (body) => {
      h.calls.verify.push(body)
      return over.verify === undefined ? { ok: true, user: { id: 'u1' } } : over.verify
    },
    devLogin: async () => {
      h.calls.devLogin++
      return over.devLoginResult === undefined ? { ok: true, user: { id: 'dev' } } : over.devLoginResult
    },
  }
  /** 取出最近一个待触发定时器并 await 其回调 */
  h.flushTimer = async () => {
    const t = h.timers.pop()
    if (!t) throw new Error('no pending timer')
    await t.fn()
  }
  h.mk = (caps, extra = {}) =>
    createLoginController({
      authOrigin: 'https://auth.hxym18.com',
      adapter: h.adapter,
      api: h.api,
      caps,
      ...extra,
    })
  return h
}

test('按端分流：微信内 → channel=wechat 且不取码；PC/手机 → 取码', async () => {
  const wx = harness()
  const c1 = wx.mk({ isWechat: true, isMobile: true })
  await c1.start()
  assert.equal(c1.getState().channel, 'wechat')
  assert.equal(wx.calls.qrcode, 0)

  const pc = harness()
  const c2 = pc.mk({ isWechat: false, isMobile: false })
  await c2.start()
  assert.equal(c2.getState().channel, 'pc')
  assert.equal(pc.calls.qrcode, 1)
  assert.equal(pc.calls.config, 1)
})

test('手机浏览器 → channel=mobile，取码后带出 pairCode', async () => {
  const h = harness({ pairCode: '042031' })
  const c = h.mk({ isWechat: false, isMobile: true })
  await c.start()
  assert.equal(c.getState().channel, 'mobile')
  assert.equal(c.getState().pairCode, '042031')
})

test('轮询：waiting → pending → ok，ok 触发 onSuccess 且不再排定时器', async () => {
  const h = harness({ pollQueue: [{ ok: true, status: 'waiting' }, { ok: true, status: 'pending' }, { ok: true, status: 'ok', user: { id: 'u9' } }] })
  const successes = []
  const c = h.mk({ isWechat: false, isMobile: false }, { onSuccess: (d) => successes.push(d) })
  await c.start()
  assert.equal(c.getState().status, 'waiting')
  await h.flushTimer()
  assert.equal(c.getState().status, 'pending')
  await h.flushTimer()
  assert.equal(c.getState().status, 'ok')
  assert.equal(c.getState().user.id, 'u9')
  assert.equal(successes.length, 1)
  assert.equal(h.timers.length, 0)
})

test('expired → 自动换新码（qrcode 再调一次）', async () => {
  // 首轮 poll 是内联调用（与原前端 issue→poll 一致），故 expired 会立即换码
  const h = harness({ pollQueue: [{ ok: true, status: 'expired' }, { ok: true, status: 'waiting' }] })
  const c = h.mk({ isWechat: false, isMobile: false })
  await c.start()
  assert.equal(h.calls.qrcode, 2)
  assert.equal(c.getState().status, 'waiting')
})

test('轮询接口异常（!ok）→ 不判死，按重试间隔继续轮询', async () => {
  const h = harness({ pollQueue: [{ ok: false, error: 'busy' }] })
  const c = h.mk({ isWechat: false, isMobile: false })
  await c.start()
  await h.flushTimer() // 触发 !ok 分支
  assert.equal(h.timers.length, 1) // 又排了一次
  assert.notEqual(c.getState().status, 'error')
})

test('config.wxEnabled=false → 报错文案，不取码', async () => {
  const h = harness({ config: { wxEnabled: false, devLogin: false } })
  const c = h.mk({ isWechat: false, isMobile: false })
  await c.start()
  assert.equal(h.calls.qrcode, 0)
  assert.equal(c.getState().status, 'error')
})

test('startSso：跳 auth 站，redirect 为当前 URL + sso=return', () => {
  const h = harness({ url: 'https://ka.hxym18.com/a?x=1' })
  const c = h.mk({ isWechat: true, isMobile: true })
  c.startSso()
  assert.equal(h.navs.length, 1)
  const u = new URL(h.navs[0])
  assert.equal(u.origin, 'https://auth.hxym18.com')
  assert.equal(u.pathname, '/')
  const back = new URL(u.searchParams.get('redirect'))
  assert.equal(back.searchParams.get('sso'), 'return')
  assert.equal(back.searchParams.get('x'), '1')
})

test('consumeReturn：带 ?sso=return + 合法票根 → 验票成功、清标记', async () => {
  const h = harness({ url: 'https://ka.hxym18.com/?sso=return&x=1', cookies: { sl_web_session: TICKET } })
  const c = h.mk({ isWechat: true, isMobile: true })
  const ok = await c.consumeReturn()
  assert.equal(ok, true)
  assert.equal(h.calls.verify.length, 1)
  assert.equal(h.calls.verify[0].ticket, TICKET)
  assert.equal(c.getState().user.id, 'u1')
  assert.equal(new URL(h.replaces[0]).searchParams.get('sso'), null)
  assert.equal(new URL(h.replaces[0]).searchParams.get('x'), '1')
})

test('consumeReturn：无标记 / 票根缺失 / 验票失败 → false 且不误判登录', async () => {
  const noMarker = harness()
  const c1 = noMarker.mk({ isWechat: true })
  assert.equal(await c1.consumeReturn(), false)
  assert.equal(noMarker.calls.verify.length, 0)

  const noTicket = harness({ url: 'https://ka.hxym18.com/?sso=return' })
  const c2 = noTicket.mk({ isWechat: true })
  assert.equal(await c2.consumeReturn(), false)
  assert.equal(noTicket.calls.verify.length, 0)

  const fail = harness({ url: 'https://ka.hxym18.com/?sso=return', cookies: { sl_web_session: TICKET }, verify: { ok: false } })
  const c3 = fail.mk({ isWechat: true })
  assert.equal(await c3.consumeReturn(), false)
  assert.equal(c3.getState().user, null)
})

test('devLogin：成功置 ok 并回调；失败置 error', async () => {
  const ok = harness()
  const c1 = ok.mk({ isWechat: false })
  assert.equal(await c1.devLogin(), true)
  assert.equal(ok.calls.devLogin, 1)
  assert.equal(c1.getState().status, 'ok')

  const bad = harness({ devLoginResult: { ok: false, error: '未开启' } })
  const c2 = bad.mk({ isWechat: false })
  assert.equal(await c2.devLogin(), false)
  assert.equal(c2.getState().status, 'error')
  assert.equal(c2.getState().error, '未开启')
})

test('createFetchApi：按相对路径取数，GET/POST 方法正确，解析 JSON', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => ({ ok: true }) }
  }
  const api = createFetchApi({ fetchImpl })
  await api.qrcode()
  await api.poll('ssologin-abc')
  await api.verify({ ticket: 't' })
  await api.config()
  await api.devLogin()
  assert.equal(calls.length, 5)
  assert.equal(calls[0].url, '/api/auth/wx-qrcode')
  assert.equal(calls[1].url, '/api/auth/wx-poll?scene=ssologin-abc')
  assert.equal(calls[2].init.method, 'POST')
  assert.equal(calls[3].url, '/api/auth/config')
  assert.equal(calls[4].init.method, 'POST')
})

test('dispose：清定时器，后续 api 回调不再更新状态', async () => {
  const h = harness()
  const states = []
  const c = h.mk({ isWechat: false, isMobile: false }, { onState: (s) => states.push(s) })
  await c.start()
  assert.equal(h.timers.length, 1)
  c.dispose()
  assert.equal(h.timers.length, 0)
  const n = states.length
  await c.refresh() // dispose 后 refresh 应安全 no-op
  assert.equal(states.length, n)
})
