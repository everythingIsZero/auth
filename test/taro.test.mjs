/**
 * taro.test.mjs — Taro 适配入口回归覆盖
 * createTaroLogin 的 api 守卫、非 H5 惰性、H5 委托 window。
 * （评审 Minor：Taro 是硬需求，入口此前无测试。）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTaroLogin } from '../src/taro.mjs'

const NOOP_API = {
  config: async () => ({ wxEnabled: true, devLogin: false }),
  qrcode: async () => ({ ok: true, scene: 'ssologin-' + 'a'.repeat(24), qrUrl: 'https://qr/1' }),
  poll: async () => ({ ok: true, status: 'waiting' }),
  verify: async () => ({ ok: true }),
  devLogin: async () => ({ ok: true }),
}

test('createTaroLogin：缺 api 抛错（小程序无标准 fetch，须自备）', () => {
  assert.throws(() => createTaroLogin({ isH5: true }), /api is required/)
})

test('createTaroLogin：非 H5（weapp）adapter 惰性——startSso 不抛、不跳', () => {
  const c = createTaroLogin({ isH5: false, caps: { isWechat: false, isMobile: true }, api: NOOP_API })
  assert.equal(c.getState().channel, 'mobile')
  assert.doesNotThrow(() => c.startSso())
})

test('createTaroLogin：H5 委托 window，startSso 跳到门面', () => {
  const win = {
    location: { href: 'https://nt.hxym18.com/' },
    document: { cookie: 'sl_web_session=' + 'b'.repeat(48) },
    history: { replaceState() {} },
    setTimeout,
    clearTimeout,
  }
  const c = createTaroLogin({ isH5: true, win, authOrigin: 'https://auth.hxym18.com', caps: { isWechat: true, isMobile: true }, api: NOOP_API })
  c.startSso()
  assert.match(win.location.href, /^https:\/\/auth\.hxym18\.com\/\?redirect=/)
})
