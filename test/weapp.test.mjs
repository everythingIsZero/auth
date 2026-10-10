/**
 * weapp.test.mjs — 小程序换码（服务端 exchangeWeappCode）+ 小程序登录接线（createWeappLogin）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exchangeWeappCode } from '../src/node.mjs'
import { createWeappLogin } from '../src/taro.mjs'

const OK = { code: 'c', appId: 'a', appSecret: 's' }

test('exchangeWeappCode：未配 appid/secret → not_configured（不请求微信）', async () => {
  let called = false
  globalThis.fetch = async () => {
    called = true
    return new Response('{}', { status: 200 })
  }
  assert.deepEqual(await exchangeWeappCode({ code: 'x' }), { ok: false, error: 'not_configured' })
  assert.equal(called, false)
})

test('exchangeWeappCode：code 非法 → bad_code', async () => {
  assert.deepEqual(await exchangeWeappCode({ ...OK, code: '' }), { ok: false, error: 'bad_code' })
})

test('exchangeWeappCode：成功带 unionid/session_key；无 unionid 时为 null', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ openid: 'o1', unionid: 'u1', session_key: 'sk' }), { status: 200 })
  assert.deepEqual(await exchangeWeappCode(OK), { ok: true, openid: 'o1', unionid: 'u1', sessionKey: 'sk' })

  globalThis.fetch = async () => new Response(JSON.stringify({ openid: 'o2' }), { status: 200 })
  assert.deepEqual(await exchangeWeappCode(OK), { ok: true, openid: 'o2', unionid: null, sessionKey: null })
})

test('exchangeWeappCode：微信 errcode（HTTP 200）→ invalid_code 带 errcode', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' }), { status: 200 })
  assert.deepEqual(await exchangeWeappCode(OK), { ok: false, error: 'invalid_code', errcode: 40029 })
})

test('exchangeWeappCode：网络错 → network；非 200 → upstream', async () => {
  globalThis.fetch = async () => {
    throw new Error('net down')
  }
  assert.deepEqual(await exchangeWeappCode(OK), { ok: false, error: 'network' })

  globalThis.fetch = async () => new Response('oops', { status: 502 })
  assert.deepEqual(await exchangeWeappCode(OK), { ok: false, error: 'upstream' })
})

test('exchangeWeappCode：body 为 null（非对象）→ bad_json，不抛错（契约：永不抛）', async () => {
  globalThis.fetch = async () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })
  assert.deepEqual(await exchangeWeappCode(OK), { ok: false, error: 'bad_json' })
})

test('createWeappLogin：缺 Taro/request 抛错', () => {
  assert.throws(() => createWeappLogin({}), /Taro is required/)
  assert.throws(() => createWeappLogin({ Taro: { login: async () => ({}) } }), /request is required/)
})

test('createWeappLogin：H5/无 login 能力 → 构造不抛、调用静默 false（同一接线可跨端加载）', async () => {
  const login = createWeappLogin({ Taro: {}, request: async () => ({ token: 'x' }) })
  assert.equal(typeof login, 'function')
  assert.equal(await login(), false)
})

test('createWeappLogin：取 code → 换 token → 落库；通道故障不清已有 token', async () => {
  let stored = 'old-token'
  const store = { set: (t) => { stored = t } }
  const login = createWeappLogin({
    Taro: { login: async () => ({ code: 'the-code' }) },
    request: async (code) => {
      assert.equal(code, 'the-code')
      return { data: { token: 'new-token' } }
    },
    store,
  })
  assert.equal(await login(), true)
  assert.equal(stored, 'new-token')

  const failing = createWeappLogin({
    Taro: { login: async () => ({ code: 'c2' }) },
    request: async () => {
      throw new Error('upstream')
    },
    store,
  })
  assert.equal(await failing(), false)
  assert.equal(stored, 'new-token', '通道故障不得清掉已有 token')
})

test('createWeappLogin：Taro.login 无 code → false（不请求）', async () => {
  let called = false
  const login = createWeappLogin({
    Taro: { login: async () => ({}) },
    request: async () => {
      called = true
      return { token: 'x' }
    },
  })
  assert.equal(await login(), false)
  assert.equal(called, false)
})
