/**
 * next.test.mjs — @app/auth/next 装配工厂测试（2026-09-16 SSO 配置驱动批 U1）
 * 用 stub fetch 假门面（不碰真实 auth-server）：验参数校验、认人三态、白名单准入、会话 cookie 形态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthRoutes, ANCHORS } from '../src/next.mjs'

const TICKET = 'a'.repeat(48)

/** 造一个假 auth-server fetch：按 path 返回给定响应 */
function stubFetch(handler) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body || '{}')
    calls.push({ url: String(url), body, headers: init.headers })
    return handler(String(url), body)
  }
  return calls
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

function baseConfig(extra) {
  process.env.AUTH_INTERNAL_URL = 'http://auth-server:3000'
  process.env.AUTH_INTERNAL_SECRET = 'secret-x'
  return {
    session: { secret: 'session-secret' },
    authServer: { url: 'http://auth-server:3000', secret: 'secret-x' },
    ...extra,
  }
}

test('锚定器枚举与声明口径一致', () => {
  assert.deepEqual([...ANCHORS], ['identity', 'allowlist', 'first-login'])
})

test('参数校验：缺 secret / 非法 anchor / allowlist 缺 anchorEnv 一律抛错', () => {
  assert.throws(() => createAuthRoutes({ session: {} }), /session\.secret/)
  assert.throws(() => createAuthRoutes(baseConfig({ anchor: 'nope' })), /未知 anchor/)
  assert.throws(() => createAuthRoutes(baseConfig({ anchor: 'allowlist' })), /anchorEnv/)
})

test('ssoVerify：票根形状不符 → 401（不打门面）', async () => {
  const calls = stubFetch(() => jsonResponse({ ok: true, openid: 'o1' }))
  const routes = createAuthRoutes(baseConfig({}))
  const res = await routes.ssoVerify(new Request('http://x/api/auth/sso-verify', { method: 'POST', body: '{"ticket":"short"}' }))
  assert.equal(res.status, 401)
  assert.equal(calls.length, 0)
})

test('ssoVerify：票根有效 → 200 + 会话 cookie；宽容接受 webSession 旧键', async () => {
  const calls = stubFetch((url, body) => {
    assert.match(url, /\/api\/auth\/introspect$/)
    assert.equal(body.ticket, TICKET)
    return jsonResponse({ ok: true, openid: 'openid-1' })
  })
  const routes = createAuthRoutes(baseConfig({ resolveIdentity: (openid) => ({ uid: 'user-' + openid, displayName: '灰邪' }) }))
  const res = await routes.ssoVerify(
    new Request('http://x/api/auth/sso-verify', { method: 'POST', body: JSON.stringify({ webSession: TICKET }) }),
  )
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.equal(data.user.id, 'user-openid-1')
  assert.match(res.headers.get('set-cookie'), /^app_session=/)
  assert.match(res.headers.get('set-cookie'), /HttpOnly/)
  assert.match(res.headers.get('set-cookie'), /Max-Age=\d+/)
  // 门面鉴权头必须带上（部署契约：x-auth-secret）
  assert.equal(calls[0].headers['x-auth-secret'], 'secret-x')
})

test('ssoVerify：票根无效（openid=null）→ 401，且不签发 cookie', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: null }))
  const routes = createAuthRoutes(baseConfig({}))
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 401)
  assert.equal(res.headers.get('set-cookie'), null)
})

test('ssoVerify：门面故障（502）→ 503 通道故障，与票无效严格区分', async () => {
  stubFetch(() => jsonResponse({ error: 'upstream' }, 502))
  const routes = createAuthRoutes(baseConfig({}))
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /暂时不可用/)
})

test('allowlist 锚定：非白名单 openid → 403，不签发会话', async () => {
  process.env.TEST_OWNER_OPENID = 'owner-1'
  stubFetch(() => jsonResponse({ ok: true, openid: 'someone-else' }))
  const routes = createAuthRoutes(baseConfig({ anchor: 'allowlist', anchorEnv: 'TEST_OWNER_OPENID' }))
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 403)
  assert.equal(res.headers.get('set-cookie'), null)
})

test('allowlist 站 403 带 configured：名单已配=true，名单未配=false（登录页据此分开说）', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'someone-else' }))
  process.env.TEST_OWNER_OPENID = 'owner-1'
  const configured = createAuthRoutes(baseConfig({ anchor: 'allowlist', anchorEnv: 'TEST_OWNER_OPENID' }))
  let res = await configured.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal((await res.json()).configured, true)

  delete process.env.TEST_OWNER_OPENID
  const unconfigured = createAuthRoutes(baseConfig({ anchor: 'allowlist', anchorEnv: 'TEST_OWNER_OPENID' }))
  res = await unconfigured.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal((await res.json()).configured, false)
})

test('identity 站 403 不带 configured（无「名单未配」这个歧义）', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'o1' }))
  const routes = createAuthRoutes(baseConfig({ resolveIdentity: () => null }))
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 403)
  assert.equal('configured' in (await res.json()), false)
})

test('会话密钥可传函数（运行期取值）；取值时为空 → 503 未配置，不签会话', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'openid-9' }))
  let secret = ''
  const routes = createAuthRoutes(baseConfig({ session: { secret: () => secret } }))

  let res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 503)
  assert.match((await res.json()).error, /会话密钥未配置/)
  assert.equal(res.headers.get('set-cookie'), null)

  secret = 'session-secret-2' // 运行期注入后同一实例立即可用
  res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('set-cookie'), /^app_session=/)
})

test('allowlist 锚定：白名单命中 → uid 即 openid（admin 现状）', async () => {
  // 真实微信 openid 为 28 位；此处用 8 位以上合法 uid 形态（issueSession 白字 8..64）
  const owner = 'owner-openid-0001'
  process.env.TEST_OWNER_OPENID = owner
  stubFetch(() => jsonResponse({ ok: true, openid: owner }))
  const routes = createAuthRoutes(baseConfig({ anchor: 'allowlist', anchorEnv: 'TEST_OWNER_OPENID' }))
  const res = await routes.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).user.id, owner)
})

test('wxPoll：scene 形态不符 → 400；ok 缺 openid → 502；ok 正常 → 200 + cookie', async () => {
  const routes = createAuthRoutes(baseConfig({}))

  stubFetch(() => jsonResponse({ ok: true, status: 'waiting' }))
  let res = await routes.wxPoll(new Request('http://x/api/auth/wx-poll?scene=bad'))
  assert.equal(res.status, 400)

  stubFetch(() => jsonResponse({ ok: true, status: 'ok', openid: null }))
  res = await routes.wxPoll(new Request('http://x/api/auth/wx-poll?scene=ssologin-' + 'a'.repeat(24)))
  assert.equal(res.status, 502)

  stubFetch(() => jsonResponse({ ok: true, status: 'ok', openid: 'openid-2' }))
  res = await routes.wxPoll(new Request('http://x/api/auth/wx-poll?scene=ssologin-' + 'a'.repeat(24)))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'ok')
  assert.match(res.headers.get('set-cookie'), /^app_session=/)
})

test('wxQrcode：门面未配置 → 503；正常 → 透传 scene/qrUrl', async () => {
  const noConf = createAuthRoutes({ session: { secret: 's' }, authServer: { url: '', secret: '' } })
  assert.equal((await noConf.wxQrcode(new Request('http://x/'))).status, 503)

  stubFetch(() => jsonResponse({ ok: true, scene: 'ssologin-' + 'b'.repeat(24), qrUrl: 'https://q', expiresIn: 300 }))
  const routes = createAuthRoutes(baseConfig({}))
  const res = await routes.wxQrcode(new Request('http://x/'))
  assert.equal(res.status, 200)
  const d = await res.json()
  assert.equal(d.qrUrl, 'https://q')
  assert.equal(d.expiresIn, 300)
})

test('wxQrcode：allowlist 站带 confirm:true 取码并透传 confirm 标记（防诱扫确认步）', async () => {
  const calls = stubFetch(() =>
    jsonResponse({ ok: true, scene: 'ssologin-' + 'c'.repeat(24), qrUrl: 'https://q', expiresIn: 300, confirm: true }),
  )
  const routes = createAuthRoutes(baseConfig({ anchor: 'allowlist', anchorEnv: 'TEST_OWNER_OPENID' }))
  const res = await routes.wxQrcode(new Request('http://x/'))
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0].body, { action: 'issue', confirm: true })
  assert.equal((await res.json()).confirm, true)
})

test('wxQrcode：非 allowlist 站不带 confirm:true，响应也不多 confirm 键（形状一字不变）', async () => {
  const calls = stubFetch(() => jsonResponse({ ok: true, scene: 'ssologin-' + 'd'.repeat(24), qrUrl: 'https://q', expiresIn: 300 }))
  const routes = createAuthRoutes(baseConfig({}))
  const res = await routes.wxQrcode(new Request('http://x/'))
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0].body, { action: 'issue' })
  assert.equal('confirm' in (await res.json()), false)
})

test('wxPoll：status=pending 原样透传且不签会话（未确认不算登录成功，前端须继续轮询）', async () => {
  stubFetch(() => jsonResponse({ ok: true, status: 'pending' }))
  const routes = createAuthRoutes(baseConfig({ anchor: 'allowlist', anchorEnv: 'TEST_OWNER_OPENID' }))
  const res = await routes.wxPoll(new Request('http://x/api/auth/wx-poll?scene=ssologin-' + 'a'.repeat(24)))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, status: 'pending' })
  assert.equal(res.headers.get('set-cookie'), null, 'pending 绝不能签发会话')
})

test('wxPoll：扫码昵称/头像与来源透传给 resolveIdentity（各站建号用）', async () => {
  stubFetch(() => jsonResponse({ ok: true, status: 'ok', openid: 'openid-3', nickname: '灰邪', avatar: 'https://a.b/av.png' }))
  let seen = null
  const routes = createAuthRoutes(
    baseConfig({
      resolveIdentity: (openid, ctx) => {
        seen = { openid, ...ctx }
        return { uid: 'user-' + openid, displayName: ctx.nickname }
      },
    }),
  )
  const res = await routes.wxPoll(new Request('http://x/api/auth/wx-poll?scene=ssologin-' + 'a'.repeat(24)))
  assert.equal(res.status, 200)
  assert.deepEqual(seen, { openid: 'openid-3', source: 'qr', nickname: '灰邪', avatar: 'https://a.b/av.png' })
  assert.equal((await res.json()).user.displayName, '灰邪')
})

test('issue：resolveIdentity 返回非法 uid（过短）→ 受控 500，不抛异常', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'openid-x' }))
  const routes = createAuthRoutes(baseConfig({ resolveIdentity: () => ({ uid: 'short' }) }))
  const res = await routes.ssoVerify(
    new Request('http://x/api/auth/sso-verify', { method: 'POST', body: JSON.stringify({ ticket: 'ab'.repeat(24) }) }),
  )
  assert.equal(res.status, 500)
  assert.equal((await res.json()).ok, false)
})

test('userPayload：resolveIdentity 返回的 avatar 透传到响应 user.avatar（前端免再调 /me）', async () => {
  stubFetch(() => jsonResponse({ ok: true, status: 'ok', openid: 'openid-av', nickname: '灰邪', avatar: 'https://a.b/av.png' }))
  const routes = createAuthRoutes(
    baseConfig({
      resolveIdentity: (openid, ctx) => ({ uid: 'user-' + openid, displayName: ctx.nickname, avatar: ctx.avatar }),
    }),
  )
  const res = await routes.wxPoll(new Request('http://x/api/auth/wx-poll?scene=ssologin-' + 'a'.repeat(24)))
  const body = await res.json()
  assert.equal(body.user.avatar, 'https://a.b/av.png')
  assert.equal(body.user.displayName, '灰邪')
})

test('ssoVerify：org 站凭票根尽力补档案，门面 profile 空对象时降级为无资料（登录不受影响）', async () => {
  const calls = stubFetch((url, body) => {
    if (url.endsWith('/api/auth/introspect')) return jsonResponse({ ok: true, openid: 'openid-sso-1' })
    return jsonResponse({ ok: true, profile: {} }) // profile 端点：票有效但池里没档案
  })
  let seen = null
  const routes = createAuthRoutes(
    baseConfig({
      authServer: { url: 'http://auth-server:3000', secret: 'secret-x', org: 'wordinput' },
      resolveIdentity: (openid, ctx) => {
        seen = { openid, ...ctx }
        return { uid: 'user-' + openid, displayName: ctx.nickname }
      },
    }),
  )
  const res = await routes.ssoVerify(new Request('http://x/api/auth/sso-verify', { method: 'POST', body: JSON.stringify({ ticket: 'ab'.repeat(24) }) }))
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).user, { id: 'user-openid-sso-1', displayName: null, avatar: null })
  // profile 端点被调用且带票根与 org
  const profileCall = calls.find((c) => c.url.endsWith('/api/auth/profile'))
  assert.ok(profileCall, 'org 站应调用 profile 端点补资料')
  assert.equal(profileCall.body.ticket, 'ab'.repeat(24))
  assert.equal(profileCall.body.org, 'wordinput')
  assert.deepEqual(seen, { openid: 'openid-sso-1', source: 'sso', nickname: null, avatar: null })
})

test('ssoVerify：门面 profile 端点故障 → 静默降级照常签发会话', async () => {
  stubFetch((url) => {
    if (url.endsWith('/api/auth/introspect')) return jsonResponse({ ok: true, openid: 'openid-sso-2' })
    return { status: 502, body: '{"error":"upstream"}' }
  })
  const routes = createAuthRoutes(
    baseConfig({
      authServer: { url: 'http://auth-server:3000', secret: 'secret-x', org: 'wordinput' },
      resolveIdentity: (openid) => ({ uid: 'user-' + openid, displayName: null }),
    }),
  )
  const res = await routes.ssoVerify(new Request('http://x/api/auth/sso-verify', { method: 'POST', body: JSON.stringify({ ticket: 'ab'.repeat(24) }) }))
  assert.equal(res.status, 200)
  assert.equal((await res.json()).ok, true, 'profile 故障绝不能阻塞登录')
})

test('wxConfigured：门面未配置 false / 已配置 true（登录页能力探测）', () => {
  assert.equal(createAuthRoutes({ session: { secret: 's' }, authServer: { url: '', secret: '' } }).wxConfigured(), false)
  assert.equal(createAuthRoutes(baseConfig({})).wxConfigured(), true)
})

test('logout：清 cookie（Max-Age=0）', async () => {
  const routes = createAuthRoutes(baseConfig({}))
  const res = await routes.logout(new Request('http://x/', { method: 'POST' }))
  assert.equal(res.status, 200)
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/)
})

test('dispatch：按路径分发，未知路径 404', async () => {
  stubFetch(() => jsonResponse({ ok: true, openid: 'o' }))
  const routes = createAuthRoutes(baseConfig({}))
  assert.equal((await routes.dispatch(new Request('http://x/api/auth/logout', { method: 'POST' }))).status, 200)
  assert.equal((await routes.dispatch(new Request('http://x/api/auth/nope', { method: 'GET' }))).status, 404)
})