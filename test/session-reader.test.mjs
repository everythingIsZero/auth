/**
 * tests/session-reader.test.mjs — auth Task T3
 *
 * 覆盖：
 *   - legacy 常量下沉 `core`（Edge 可载：core 无 node 密码学模块）并保证 `node` 出口向后兼容
 *   - `createSessionReader({secret,ttlSec,legacyCookies,loadUser})` 的 `read` / `renew`
 *     （读取有效会话 / 过期被拒 / legacy 64hex 兼容 / 续期 Node Response / secure 单源）
 *
 * 行为对齐两站现有 `lib/auth.ts`：`sessions` 列/DB 由站点 `loadUser` 提供，
 * 本层只负责 cookie 名、TTL、legacy 64hex 判定、静默续期、legacy 升级写新名。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSessionReader } from '../src/server.mjs'
import { issueSession, readSession } from '../src/node.mjs'
import * as core from '../src/core.mjs'
import * as node from '../src/node.mjs'

const SECRET = 'reader-secret-01'
const UID = 'user-00000001' // 匹配 /^[A-Za-z0-9_-]{8,64}$/
const TOKEN64 = 'a'.repeat(64)

// Node 原生 Request 需要合法 URL；cookie 为唯一入参
const req = (cookie) => new Request('http://x/', { headers: cookie ? { cookie } : {} })

/** 造一个最小 reader：session 命中 UID、legacy 命中固定 user。记录 loadUser 调用。 */
function makeReader(over = {}) {
  const seen = []
  const reader = createSessionReader({
    secret: SECRET,
    ttlSec: 100,
    legacyCookies: ['wi_session'],
    loadUser: (idOrToken, info) => {
      seen.push([idOrToken, info])
      if (info.kind === 'session' && idOrToken === UID) return { id: UID, display_name: 'u' }
      if (info.kind === 'legacy' && idOrToken === TOKEN64) return { id: UID, display_name: 'legacy' }
      return null
    },
    ...over,
  })
  return { reader, seen }
}

/* ----------------------- legacy 常量下沉 core ----------------------- */

test('core：legacy 常量已下沉（旧 cookie 名 + 64hex 正则）', () => {
  assert.equal(core.LEGACY_HMD_COOKIE, 'hmd2')
  assert.equal(core.LEGACY_HMD_WECHAT_COOKIE, 'hmd2w')
  assert.equal(core.LEGACY_WORDINPUT_COOKIE, 'wi_session')
  assert.equal(core.LEGACY_FANG_COOKIE, 'fang_session')
  assert.deepEqual(core.LEGACY_SESSION_COOKIES, ['hmd2w', 'hmd2', 'wi_session', 'fang_session'])
  assert.ok(core.LEGACY_HEX_RE instanceof RegExp)
  assert.equal(core.LEGACY_HEX_RE.test(TOKEN64), true)
  assert.equal(core.LEGACY_HEX_RE.test('g'.repeat(64)), false)
  assert.equal(core.LEGACY_HEX_RE.test('a'.repeat(63)), false)
  assert.equal(core.LEGACY_HEX_RE.test('A'.repeat(64)), false) // 小写口径（与 sessions.token 一致）
})

test('node 出口向后兼容：legacy 常量与 core 同源（同一绑定，不产生 export* 歧义）', () => {
  assert.equal(node.LEGACY_HMD_COOKIE, core.LEGACY_HMD_COOKIE)
  assert.equal(node.LEGACY_WORDINPUT_COOKIE, core.LEGACY_WORDINPUT_COOKIE)
  assert.equal(node.LEGACY_FANG_COOKIE, core.LEGACY_FANG_COOKIE)
  assert.deepEqual(node.LEGACY_SESSION_COOKIES, core.LEGACY_SESSION_COOKIES)
  assert.equal(node.LEGACY_HEX_RE, core.LEGACY_HEX_RE)
})

/* ----------------------- createSessionReader ----------------------- */

test('read：有效 app_session → loadUser(uid,{kind:session}) → 用户', async () => {
  const { reader, seen } = makeReader()
  const { value } = issueSession(UID, { secret: SECRET, ttlSec: 100 })
  const user = await reader.read(req(`app_session=${value}`))
  assert.equal(user.id, UID)
  assert.deepEqual(seen, [[UID, { kind: 'session' }]])
})

test('read：过期会话被拒（绝对过期）→ null，且不查用户', async () => {
  const { reader, seen } = makeReader()
  const { value, iat } = issueSession(UID, { secret: SECRET, ttlSec: 100 })
  const realNow = Date.now
  Date.now = () => (iat + 101) * 1000
  try {
    assert.equal(await reader.read(req(`app_session=${value}`)), null)
  } finally {
    Date.now = realNow
  }
  assert.deepEqual(seen, [])
})

test('read：签名不符 / 非法值 / 缺失 → null（不抛错）', async () => {
  const { reader } = makeReader()
  const { value } = issueSession(UID, { secret: 'other-secret' })
  assert.equal(await reader.read(req(`app_session=${value}`)), null)
  assert.equal(await reader.read(req('app_session=garbage')), null)
  assert.equal(await reader.read(req('')), null)
  assert.equal(await reader.read(new Request('http://x/')), null)
})

test('read：legacy 64hex cookie → loadUser(token,{kind:legacy,source}) → 用户', async () => {
  const { reader, seen } = makeReader()
  const user = await reader.read(req(`wi_session=${TOKEN64}`))
  assert.equal(user.id, UID)
  assert.deepEqual(seen, [[TOKEN64, { kind: 'legacy', source: 'wi_session' }]])
})

test('read：legacy 非 64hex / 缺 cookie → null，不查用户', async () => {
  const { reader, seen } = makeReader()
  assert.equal(await reader.read(req(`wi_session=${'a'.repeat(63)}`)), null)
  assert.equal(await reader.read(req(`wi_session=${'g'.repeat(64)}`)), null)
  assert.equal(await reader.read(req('app_session=bad; wi_session=short')), null)
  assert.deepEqual(seen, [])
})

test('read：新会话有效但用户不存在 → 回落 legacy 双读', async () => {
  const kinds = []
  const reader = createSessionReader({
    secret: SECRET,
    ttlSec: 100,
    legacyCookies: ['wi_session'],
    loadUser: (_id, info) => {
      kinds.push(info.kind)
      return info.kind === 'legacy' ? { id: UID } : null
    },
  })
  const { value } = issueSession('missing-user-1', { secret: SECRET })
  const user = await reader.read(req(`app_session=${value}; wi_session=${TOKEN64}`))
  assert.equal(user.id, UID)
  assert.deepEqual(kinds, ['session', 'legacy'])
})

test('renew：stale 未过期 → 带 Set-Cookie 的 Response；新鲜 → null', async () => {
  const { reader } = makeReader()
  const { value, iat } = issueSession(UID, { secret: SECRET, ttlSec: 100 })
  // 新鲜（age=0 < halfLife=50）→ null
  assert.equal(await reader.renew(req(`app_session=${value}`)), null)
  const realNow = Date.now
  Date.now = () => (iat + 60) * 1000
  try {
    const res = await reader.renew(req(`app_session=${value}`))
    assert.ok(res instanceof Response)
    const setCookie = res.headers.get('set-cookie')
    assert.match(setCookie, /^app_session=/)
    assert.match(setCookie, /Max-Age=100/)
    const fresh = setCookie.slice('app_session='.length).split(';')[0]
    assert.deepEqual(readSession(fresh, { secret: SECRET, ttlSec: 100 }), { uid: UID, iat: iat + 60 })
  } finally {
    Date.now = realNow
  }
})

test('renew：已绝对过期 → null（不可续期）', async () => {
  const { reader } = makeReader()
  const { value, iat } = issueSession(UID, { secret: SECRET, ttlSec: 100 })
  const realNow = Date.now
  Date.now = () => (iat + 101) * 1000
  try {
    assert.equal(await reader.renew(req(`app_session=${value}`)), null)
  } finally {
    Date.now = realNow
  }
})

test('renew：legacy 命中 → 无条件升级签发新 app_session（写新名）', async () => {
  const { reader } = makeReader()
  const res = await reader.renew(req(`wi_session=${TOKEN64}`))
  assert.ok(res instanceof Response)
  const setCookie = res.headers.get('set-cookie')
  assert.match(setCookie, /^app_session=/)
  const fresh = setCookie.slice('app_session='.length).split(';')[0]
  const back = readSession(fresh, { secret: SECRET, ttlSec: 100 })
  assert.equal(back.uid, UID)
})

test('renew：legacy 命中但用户不存在 → null（不签空会话）', async () => {
  const { reader } = makeReader()
  assert.equal(await reader.renew(req(`wi_session=${'b'.repeat(64)}`)), null)
})

test('secure 单源：renew 的 Set-Cookie 决策与 core.resolveSessionSecure 一致（签发侧同款）', async () => {
  const { value, iat } = issueSession(UID, { secret: SECRET, ttlSec: 100 })
  const realNow = Date.now
  Date.now = () => (iat + 60) * 1000
  const mk = (over) => makeReader(over).reader
  const cookieOf = async (over) => {
    const res = await mk(over).renew(req(`app_session=${value}`))
    return res.headers.get('set-cookie')
  }
  try {
    // 默认恒 Secure（不看 env）
    assert.match(await cookieOf({}), /Secure/)
    // 注入 env 生产 + 显式 false → fail-closed 仍 Secure（与 resolveSessionSecure 判定一致）
    const prod = { NODE_ENV: 'production' }
    assert.equal(core.resolveSessionSecure((k) => prod[k], false), true)
    assert.match(await cookieOf({ secure: false, env: prod }), /Secure/)
    // 非生产 + 显式 false → 不带 Secure（与 resolveSessionSecure 判定一致）
    const dev = { NODE_ENV: 'development' }
    assert.equal(core.resolveSessionSecure((k) => dev[k], false), false)
    assert.doesNotMatch(await cookieOf({ secure: false, env: dev }), /Secure/)
  } finally {
    Date.now = realNow
  }
})

test('secret 可为函数（按请求取值）；缺 secret → read/renew 均 null', async () => {
  const { value } = issueSession(UID, { secret: SECRET })
  const fn = createSessionReader({
    secret: () => SECRET,
    legacyCookies: [],
    loadUser: () => ({ id: UID }),
  })
  assert.equal((await fn.read(req(`app_session=${value}`))).id, UID)
  const none = createSessionReader({
    legacyCookies: [],
    loadUser: () => ({ id: UID }),
  })
  assert.equal(await none.read(req(`app_session=${value}`)), null)
  assert.equal(await none.renew(req(`app_session=${value}`)), null)
})

test('cookieName 可覆写（默认 app_session）', async () => {
  const { value } = issueSession(UID, { secret: SECRET })
  const reader = createSessionReader({
    secret: SECRET,
    cookieName: 'custom_sess',
    legacyCookies: [],
    loadUser: () => ({ id: UID }),
  })
  assert.equal((await reader.read(req(`custom_sess=${value}`))).id, UID)
  assert.equal(await reader.read(req(`app_session=${value}`)), null)
})

test('legacyCookies 与统一会话同名 / 空串 → 忽略（沿用 createAuthServer 口径）', async () => {
  const seen = []
  const reader = createSessionReader({
    secret: SECRET,
    legacyCookies: ['app_session', '', 'wi_session'],
    loadUser: (id, info) => {
      seen.push([id, info])
      return { id: UID }
    },
  })
  // app_session 名被过滤，故 64hex 值只按统一会话形态解析（非法）→ 落到 wi_session 分支
  assert.equal((await reader.read(req(`wi_session=${TOKEN64}`))).id, UID)
  assert.deepEqual(seen, [[TOKEN64, { kind: 'legacy', source: 'wi_session' }]])
})
