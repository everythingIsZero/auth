/**
 * adapters.test.mjs — 平台适配层（node:test）
 * browserAdapter 把 window 归一成控制器需要的 adapter；taroAdapter 在非 H5 端保持惰性
 * （weapp 无全域 cookie/网页跳转，登录走各自身份源），不报错、不空转。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { browserAdapter, taroAdapter } from '../src/controller.mjs'

function fakeWin() {
  const w = {
    location: { href: 'https://ka.hxym18.com/?a=1' },
    document: { cookie: 'sl_web_session=' + 'b'.repeat(48) + '; other=x%20y' },
    history: {
      replaceState: (_s, _t, u) => {
        w.location.href = u
      },
    },
    setTimeout: (fn, ms) => {
      w._t = { fn, ms }
      return 7
    },
    clearTimeout: (id) => {
      w._cleared = id
    },
  }
  return w
}

test('browserAdapter：读 cookie（含 decode）/ 当前 URL / replaceUrl / navigate', () => {
  const w = fakeWin()
  const a = browserAdapter(w)
  assert.equal(a.readCookie('sl_web_session'), 'b'.repeat(48))
  assert.equal(a.readCookie('other'), 'x y')
  assert.equal(a.readCookie('missing'), '')
  assert.equal(a.currentUrl(), 'https://ka.hxym18.com/?a=1')

  a.replaceUrl('https://ka.hxym18.com/clean')
  assert.equal(a.currentUrl(), 'https://ka.hxym18.com/clean')

  a.navigate('https://auth.hxym18.com/?redirect=x')
  assert.equal(a.currentUrl(), 'https://auth.hxym18.com/?redirect=x')
})

test('browserAdapter：定时器转发到宿主', () => {
  const w = fakeWin()
  const a = browserAdapter(w)
  const id = a.setTimeout(() => {}, 123)
  assert.equal(id, 7)
  assert.equal(w._t.ms, 123)
  a.clearTimeout(id)
  assert.equal(w._cleared, 7)
})

test('taroAdapter：非 H5（weapp）惰性——读不到 cookie、不跳转、不抛错', () => {
  const a = taroAdapter({}, { isH5: false })
  assert.equal(a.readCookie('sl_web_session'), '')
  assert.equal(a.currentUrl(), '')
  assert.doesNotThrow(() => a.navigate('https://auth.hxym18.com/'))
  assert.doesNotThrow(() => a.replaceUrl('https://nt.hxym18.com/'))
})

test('taroAdapter：H5 端委托给 window（复用 browserAdapter 语义）', () => {
  const w = fakeWin()
  const a = taroAdapter({}, { isH5: true, win: w })
  assert.equal(a.readCookie('sl_web_session'), 'b'.repeat(48))
  assert.equal(a.currentUrl(), 'https://ka.hxym18.com/?a=1')
  a.navigate('https://auth.hxym18.com/')
  assert.equal(a.currentUrl(), 'https://auth.hxym18.com/')
})
