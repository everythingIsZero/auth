/**
 * facade.test.mjs — S10：auth ↔ sso-bridge 门面契约
 *
 * fake 门面按契约形态应答，断言 auth 正确消费字段（不是「元素存在」，是**取用值**）：
 *   - introspect → { openid, unionid? }
 *   - profile    → { profile: { nickname, avatar } }
 *   - qr/issue   → { scene, qrUrl, pairCode?, confirm? }
 *   - qr/poll    → { status, openid?, nickname?, avatar?, unionid? }
 *
 * 覆盖 unionid **有/无**两态：真门面当前 introspect 只回 openid（unionid 为 pending），
 * auth 必须在缺 unionid 时照常登录、不报错（unionid 透传为 null）。
 *
 * mock 方式与 server.test.mjs 同款：桩 globalThis.fetch（callAuthServer 的唯一出口）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthServer } from '../src/server.mjs'

const TICKET = 'a'.repeat(48)
const SCENE = 'ssologin-' + 'a'.repeat(24)

/** fake 门面：按请求 path 返回预设 body（或 route 函数），记录每次 { path, payload }。 */
function fakeFacade(routes) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname
    const payload = JSON.parse((init && init.body) || '{}')
    calls.push({ path, payload })
    const body = typeof routes === 'function' ? routes(path, payload) : routes[path]
    if (body == null) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return calls
}

const base = {
  session: { secret: 's'.repeat(32) },
  authServer: { url: 'http://x', secret: 'k' },
}

/* ---------------- introspect → { openid, unionid? } ---------------- */

test('门面契约：introspect 仅回 openid（当前真门面）→ 登录成功、unionid 为 null、不报错', async () => {
  fakeFacade({ '/api/auth/introspect': { ok: true, openid: 'o-sso' } })
  let seen = null
  const s = createAuthServer({
    ...base,
    resolveIdentity: (openid, ctx) => {
      seen = { openid, ...ctx }
      return { uid: 'user-' + openid }
    },
  })
  const r = await s.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(r.status, 200)
  assert.deepEqual(seen, { openid: 'o-sso', source: 'sso', nickname: null, avatar: null, unionid: null })
})

test('门面契约：introspect 回 unionid → 透传给 resolveIdentity', async () => {
  fakeFacade({ '/api/auth/introspect': { ok: true, openid: 'o-sso', unionid: 'u-sso' } })
  let seen = null
  const s = createAuthServer({
    ...base,
    resolveIdentity: (openid, ctx) => {
      seen = ctx
      return { uid: 'user-' + openid }
    },
  })
  const r = await s.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(r.status, 200)
  assert.equal(seen.unionid, 'u-sso')
})

/* ---------------- profile → { profile: { nickname, avatar } } ---------------- */

test('门面契约：profile 回 {profile:{nickname,avatar}} → 透传给 resolveIdentity（且带 org）', async () => {
  const calls = fakeFacade({
    '/api/auth/introspect': { ok: true, openid: 'o-sso' },
    '/api/auth/profile': { profile: { nickname: '昵称甲', avatar: 'https://a/av.png' } },
  })
  let seen = null
  const s = createAuthServer({
    ...base,
    authServer: { url: 'http://x', secret: 'k', org: 'org-1' },
    resolveIdentity: (openid, ctx) => {
      seen = ctx
      return { uid: 'user-' + openid }
    },
  })
  const r = await s.ssoVerify(new Request('http://x/', { method: 'POST', body: JSON.stringify({ ticket: TICKET }) }))
  assert.equal(r.status, 200)
  assert.equal(seen.nickname, '昵称甲')
  assert.equal(seen.avatar, 'https://a/av.png')
  const prof = calls.find((c) => c.path === '/api/auth/profile')
  assert.ok(prof, '应调用 /api/auth/profile')
  assert.equal(prof.payload.org, 'org-1', 'profile 请求应带 org')
})

/* ---------------- qr/issue → { scene, qrUrl, pairCode?, confirm? } ---------------- */

test('门面契约：qr/issue 回 {scene,qrUrl}（可选 pairCode/confirm 缺省不带）', async () => {
  fakeFacade({ '/api/auth/qr/issue': { scene: SCENE, qrUrl: 'https://qr/x.png', expiresIn: 300 } })
  const s = createAuthServer({ ...base, resolveIdentity: (openid) => ({ uid: 'user-' + openid }) })
  const b = await (await s.wxQrcode()).json()
  assert.equal(b.ok, true)
  assert.equal(b.scene, SCENE)
  assert.equal(b.qrUrl, 'https://qr/x.png')
  assert.equal('pairCode' in b, false, '门面未回 pairCode → 响应不带')
  assert.equal('confirm' in b, false, '门面未回 confirm → 响应不带')
})

test('门面契约：qr/issue 回 pairCode/confirm → 原样透传', async () => {
  fakeFacade({ '/api/auth/qr/issue': { scene: SCENE, qrUrl: 'https://qr/x.png', pairCode: '246810', confirm: true } })
  const s = createAuthServer({ ...base, resolveIdentity: (openid) => ({ uid: 'user-' + openid }) })
  const b = await (await s.wxQrcode()).json()
  assert.equal(b.pairCode, '246810')
  assert.equal(b.confirm, true)
})

/* ---------------- qr/poll → { status, openid?, nickname?, avatar?, unionid? } ---------------- */

test('门面契约：qr/poll status 非 ok（pending）→ 原样透传，不签会话', async () => {
  fakeFacade({ '/api/auth/qr/poll': { ok: true, status: 'pending' } })
  const s = createAuthServer({ ...base, resolveIdentity: (openid) => ({ uid: 'user-' + openid }) })
  const r = await s.wxPoll(new Request('http://x/api/auth/wx-poll?scene=' + SCENE))
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true, status: 'pending' })
})

test('门面契约：qr/poll status=ok + {openid,nickname,avatar,unionid} → 签会话并透传', async () => {
  fakeFacade({
    '/api/auth/qr/poll': {
      ok: true,
      status: 'ok',
      openid: 'o-qr',
      nickname: '扫码昵称',
      avatar: 'https://a/qr.png',
      unionid: 'u-qr',
    },
  })
  let seen = null
  const s = createAuthServer({
    ...base,
    resolveIdentity: (openid, ctx) => {
      seen = ctx
      return { uid: 'user-' + openid }
    },
  })
  const r = await s.wxPoll(new Request('http://x/api/auth/wx-poll?scene=' + SCENE))
  assert.equal(r.status, 200)
  const b = await r.json()
  assert.equal(b.ok, true)
  assert.equal(b.status, 'ok')
  assert.match(r.headers.get('set-cookie'), /^app_session=/)
  assert.deepEqual(seen, { source: 'qr', nickname: '扫码昵称', avatar: 'https://a/qr.png', unionid: 'u-qr' })
})

test('门面契约：qr/poll status=ok 无 unionid（当前真门面）→ 不报错、unionid 为 null', async () => {
  fakeFacade({ '/api/auth/qr/poll': { ok: true, status: 'ok', openid: 'o-qr', nickname: '扫码昵称' } })
  let seen = null
  const s = createAuthServer({
    ...base,
    resolveIdentity: (openid, ctx) => {
      seen = ctx
      return { uid: 'user-' + openid }
    },
  })
  const r = await s.wxPoll(new Request('http://x/api/auth/wx-poll?scene=' + SCENE))
  assert.equal(r.status, 200)
  assert.equal((await r.json()).ok, true)
  assert.equal(seen.unionid, null, '门面未回 unionid → 透传 null，不阻塞')
})
