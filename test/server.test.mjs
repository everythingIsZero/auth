/**
 * server.test.mjs — 框架无关核心 createAuthServer + Hono 薄适配
 * 覆盖：env 注入（不绑 process.env）/ Secure cookie / Context→Request 映射 / dispatch 通配。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthServer } from '../src/server.mjs'
import { createHonoAuthRoutes } from '../src/hono.mjs'

const TICKET = 'a'.repeat(48)

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => handler(String(url), JSON.parse((init && init.body) || '{}'))
}
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

test('server：env 可注入——allowlist 白名单与 Secure cookie 均从注入 env 读，不碰 process.env', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'owner-openid-0001' }))
  delete process.env.TEST_INJ_OWNER
  const routes = createAuthServer({
    session: { secret: 's' },
    authServer: { url: 'http://x', secret: 'k' },
    anchor: 'allowlist',
    anchorEnv: 'TEST_INJ_OWNER',
    env: { TEST_INJ_OWNER: 'owner-openid-0001', NODE_ENV: 'production' },
  })
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('set-cookie'), /Secure/, '注入 env NODE_ENV=production → cookie 带 Secure')
  assert.equal(process.env.TEST_INJ_OWNER, undefined, '不得写入真实 process.env')
})

test('server：env 传函数亦可（运行时取 env）', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'openid-0001' }))
  const routes = createAuthServer({
    session: { secret: 's' },
    authServer: { url: 'http://x', secret: 'k' },
    env: (k) => (k === 'NODE_ENV' ? 'production' : ''),
  })
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('set-cookie'), /Secure/)
})

test('hono：Context → 核心 Request（ssoVerify 签会话 / wxPoll 取查询串）', async () => {
  stubFetch((url) => {
    if (url.includes('introspect')) return jsonResponse({ ok: true, openid: 'openid-1' })
    return jsonResponse({ ok: true, status: 'waiting' })
  })
  const auth = createHonoAuthRoutes({ session: { secret: 's' }, authServer: { url: 'http://x', secret: 'k' } })

  const poll = await auth.wxPoll({ req: { raw: new Request('http://x/api/auth/wx-poll?scene=ssologin-' + 'a'.repeat(24)) } })
  assert.equal(poll.status, 200)
  assert.deepEqual(await poll.json(), { ok: true, status: 'waiting' })

  const verify = await auth.ssoVerify({
    req: { raw: new Request('http://x/api/auth/sso-verify', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }) },
  })
  assert.equal(verify.status, 200)
  assert.match(verify.headers.get('set-cookie'), /^app_session=/)
})

test('hono：dispatch 通配 + wxConfigured + 未知路径 404', async () => {
  const auth = createHonoAuthRoutes({ session: { secret: 's' }, authServer: { url: 'http://x', secret: 'k' } })
  assert.equal(auth.wxConfigured(), true)
  const res = await auth.dispatch({ req: { raw: new Request('http://x/api/auth/nope', { method: 'GET' }) } })
  assert.equal(res.status, 404)
})

test('server：weappVerify 走共享 resolveIdentity（unionid 贯通）+ 签 token（站点无需自写锚定）', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /jscode2session/)
    return new Response(JSON.stringify({ openid: 'o-weapp', unionid: 'u-weapp' }), { status: 200 })
  }
  let seen = null
  const routes = createAuthServer({
    session: { secret: 's' },
    weapp: { appId: 'a', appSecret: 'sec' },
    resolveIdentity: (openid, ctx) => {
      seen = { openid, ...ctx }
      return { uid: 'user-' + openid, displayName: 'wx' }
    },
  })
  const res = await routes.weappVerify(
    new Request('http://x/api/auth/weapp', { method: 'POST', body: JSON.stringify({ code: 'the-code' }) }),
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(typeof body.token, 'string')
  assert.equal(body.user.id, 'user-o-weapp')
  assert.deepEqual(seen, { openid: 'o-weapp', source: 'weapp', nickname: null, avatar: null, unionid: 'u-weapp' })
})

test('server：weapp 未配置 → 404（通道未启用，非登录失败）', async () => {
  const routes = createAuthServer({ session: { secret: 's' }, env: {} })
  const res = await routes.weappVerify(
    new Request('http://x/api/auth/weapp', { method: 'POST', body: JSON.stringify({ code: 'c' }) }),
  )
  assert.equal(res.status, 404)
})

test('server：dispatch 覆盖 weapp 动作', async () => {
  const routes = createAuthServer({ session: { secret: 's' }, env: {} })
  const res = await routes.dispatch(new Request('http://x/api/auth/weapp', { method: 'POST', body: '{}' }))
  assert.equal(res.status, 404)
})

test('server：sso 路径 unionid-ready——门面返回 unionid 即透传给 resolveIdentity（未返回则为 null）', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /introspect/)
    return new Response(JSON.stringify({ ok: true, openid: 'o-sso', unionid: 'u-sso' }), { status: 200 })
  }
  let seen = null
  const routes = createAuthServer({
    session: { secret: 's' },
    authServer: { url: 'http://x', secret: 'k' },
    resolveIdentity: (openid, ctx) => {
      seen = ctx
      return { uid: 'user-' + openid }
    },
  })
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 200)
  assert.equal(seen.unionid, 'u-sso', '门面返回 unionid 应透传，站点无需改核心')
})
