/**
 * taro.test.mjs — Taro 适配入口回归覆盖
 * createTaroLogin 的 api 守卫、非 H5 惰性、H5 委托 window。
 * （评审 Minor：Taro 是硬需求，入口此前无测试。）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTaroLogin, createTaroApi } from '../src/taro.mjs'

const NOOP_API = {
  config: async () => ({ wxEnabled: true, devLogin: false }),
  qrcode: async () => ({ ok: true, scene: 'ssologin-' + 'a'.repeat(24), qrUrl: 'https://qr/1' }),
  poll: async () => ({ ok: true, status: 'waiting' }),
  verify: async () => ({ ok: true }),
  devLogin: async () => ({ ok: true }),
}

test('createTaroLogin：缺 api 抛错（小程序无标准 fetch，须自备）', () => {
  assert.throws(() => createTaroLogin({}), /api is required/)
})

test('createTaroLogin：无 window（weapp）adapter 惰性——startSso 不抛、不跳', () => {
  const c = createTaroLogin({ caps: { isWechatInApp: false, isMobileBrowser: true }, api: NOOP_API })
  assert.equal(c.getState().channel, 'mobile')
  assert.doesNotThrow(() => c.startSso())
})

test('createTaroLogin：有 window 委托 browserAdapter，startSso 跳到门面（不看 isH5）', () => {
  const win = {
    location: { href: 'https://nt.hxym18.com/' },
    document: { cookie: 'sl_web_session=' + 'b'.repeat(48) },
    history: { replaceState() {} },
    setTimeout,
    clearTimeout,
  }
  // 显式传 isH5:false 也应以 window 为准——isH5 不再是终端判据
  const c = createTaroLogin({ isH5: false, win, authOrigin: 'https://auth.hxym18.com', caps: { isWechatInApp: true, isMobileBrowser: true }, api: NOOP_API })
  c.startSso()
  assert.match(win.location.href, /^https:\/\/auth\.hxym18\.com\/\?redirect=/)
})

test('createTaroApi：缺 request 抛错（不猜全局 fetch）', () => {
  assert.throws(() => createTaroApi({}), /request is required/)
})

test('createTaroApi：映射五个端点（方法 + poll scene 编码）', async () => {
  const seen = []
  const api = createTaroApi({
    request: (o) => {
      seen.push(o)
      return Promise.resolve({ statusCode: 200, data: { ok: true } })
    },
  })
  await api.config()
  await api.qrcode()
  await api.poll('ssologin-' + 'a'.repeat(24))
  await api.verify({ ticket: 'x' })
  await api.devLogin()
  assert.deepEqual(seen.map((o) => o.method), ['GET', 'GET', 'GET', 'POST', 'POST'])
  assert.equal(seen[0].url, '/api/auth/config')
  assert.equal(seen[1].url, '/api/auth/wx-qrcode')
  assert.match(seen[2].url, /^\/api\/auth\/wx-poll\?scene=ssologin-/)
  assert.equal(seen[3].data.ticket, 'x')
  assert.equal(seen[0].header['content-type'], 'application/json')
})

test('createTaroLogin：接 createTaroApi 后 H5 start 会取码（端到端接线）', async () => {
  const seen = []
  const api = createTaroApi({
    request: (o) => {
      seen.push(o)
      const data = o.url.includes('config')
        ? { ok: true, wxEnabled: true, devLogin: false }
        : { ok: true, scene: 'ssologin-' + 'a'.repeat(24), qrUrl: 'https://qr/1' }
      return Promise.resolve({ statusCode: 200, data })
    },
  })
  const win = {
    location: { href: 'https://nt.hxym18.com/' },
    document: { cookie: '' },
    history: { replaceState() {} },
    setTimeout,
    clearTimeout,
  }
  const c = createTaroLogin({ win, caps: { isWechatInApp: false, isMobileBrowser: false }, api })
  await c.start()
  assert.ok(seen.some((o) => o.url.includes('wx-qrcode')), '应请求取码端点')
  c.dispose()
})
