/**
 * tests/node.test.mjs — @app/auth 服务端层测试（node:test，零依赖，无网络）
 * 覆盖：callAuthServer 契约（URL/头/body/超时）/ 失败归一（未配置·超时·网络·非2xx·非JSON）/
 *       会话原语 issueSession·readSession·renewIfStale（版本前缀·验签·篡改·边界）/
 *       旧 cookie 双读（hmd2/hmd2w HMAC 系 + wi_session/fang_session token 系）/ index 出口聚合
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTH_SERVER_TIMEOUT_MS,
  SESSION_VERSION,
  callAuthServer,
  issueSession,
  readSession,
  renewIfStale,
  readCookieValue,
  readLegacySession,
  LEGACY_HMD_COOKIE,
  LEGACY_HMD_WECHAT_COOKIE,
  LEGACY_WORDINPUT_COOKIE,
  LEGACY_FANG_COOKIE,
  LEGACY_SESSION_COOKIES,
  hmacSign,
} from '../src/node.mjs'
import * as index from '../src/index.mjs'

const SECRET = 'test-secret-001'
const UID = 'abcd1234-ef56' // 匹配 /^[A-Za-z0-9_-]{8,64}$/

/** 装 fetch stub，返回 { calls, restore } */
function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** 伪 Response：callAuthServer 只读 ok / status / json() */
function fakeRes({ status = 200, body = '{}', jsonThrows = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (jsonThrows) throw new Error('invalid json')
      return JSON.parse(body)
    },
  }
}

const BASE = 'http://auth-server:3000'

/* ------------------------------ callAuthServer ------------------------------ */

test('callAuthServer：成功契约逐项核对（URL/方法/头/body/data）', async () => {
  const { calls, restore } = stubFetch(() => fakeRes({ status: 200, body: JSON.stringify({ ok: true, scene: 'ssologin-abc', qrUrl: 'https://x', expiresIn: 300 }) }))
  try {
    const r = await callAuthServer(BASE, '/api/auth/qr/issue', { action: 'issue' }, { secret: SECRET })
    assert.deepEqual(r, { ok: true, data: { ok: true, scene: 'ssologin-abc', qrUrl: 'https://x', expiresIn: 300 } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${BASE}/api/auth/qr/issue`)
    assert.equal(calls[0].init.method, 'POST')
    assert.equal(calls[0].init.headers['content-type'], 'application/json')
    assert.equal(calls[0].init.headers['x-auth-secret'], SECRET)
    assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'issue' })
    assert.equal(calls[0].init.cache, 'no-store')
  } finally {
    restore()
  }
})

test('callAuthServer：baseUrl 尾斜杠归一，path 拼接不重复', async () => {
  const { calls, restore } = stubFetch(() => fakeRes({ status: 200, body: '{}' }))
  try {
    await callAuthServer(`${BASE}///`, '/api/auth/qr/poll', { action: 'poll', scene: 's' }, { secret: SECRET })
    assert.equal(calls[0].url, `${BASE}/api/auth/qr/poll`)
  } finally {
    restore()
  }
})

test('callAuthServer：payload 为 null/undefined → body 归一为 {}', async () => {
  const { calls, restore } = stubFetch(() => fakeRes({ status: 200, body: '{}' }))
  try {
    await callAuthServer(BASE, '/healthz', null, { secret: SECRET })
    assert.equal(calls[0].init.body, '{}')
  } finally {
    restore()
  }
})

test('callAuthServer：未配置（缺 baseUrl / 缺 secret）→ not_configured，不发起请求', async () => {
  const { calls, restore } = stubFetch(() => fakeRes({ status: 200, body: '{}' }))
  try {
    assert.deepEqual(await callAuthServer('', '/x', {}, { secret: SECRET }), { ok: false, error: 'not_configured' })
    assert.deepEqual(await callAuthServer(BASE, '/x', {}, {}), { ok: false, error: 'not_configured' })
    assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: '' }), { ok: false, error: 'not_configured' })
    assert.equal(calls.length, 0)
  } finally {
    restore()
  }
})

test('callAuthServer：非 2xx → http_<status>（401/502），不解析 body', async () => {
  const { restore } = stubFetch(() => fakeRes({ status: 401, body: JSON.stringify({ error: 'unauthorized' }) }))
  try {
    assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: SECRET }), { ok: false, error: 'http_401' })
  } finally {
    restore()
  }
  const r = stubFetch(() => fakeRes({ status: 502, body: JSON.stringify({ error: 'upstream' }) }))
  try {
    assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: SECRET }), { ok: false, error: 'http_502' })
  } finally {
    r.restore()
  }
})

test('callAuthServer：超时（TimeoutError/AbortError）→ timeout', async () => {
  for (const name of ['TimeoutError', 'AbortError']) {
    const err = new Error('timed out')
    err.name = name
    const { restore } = stubFetch(() => { throw err })
    try {
      assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: SECRET }), { ok: false, error: 'timeout' })
    } finally {
      restore()
    }
  }
})

test('callAuthServer：网络层异常 → network', async () => {
  const { restore } = stubFetch(() => { throw new Error('ECONNREFUSED') })
  try {
    assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: SECRET }), { ok: false, error: 'network' })
  } finally {
    restore()
  }
})

test('callAuthServer：2xx 非 JSON（解析抛错 / null / 标量）→ bad_json', async () => {
  const a = stubFetch(() => fakeRes({ status: 200, jsonThrows: true }))
  try {
    assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: SECRET }), { ok: false, error: 'bad_json' })
  } finally {
    a.restore()
  }
  for (const body of ['null', '"scalar"', '123']) {
    const b = stubFetch(() => fakeRes({ status: 200, body }))
    try {
      assert.deepEqual(await callAuthServer(BASE, '/x', {}, { secret: SECRET }), { ok: false, error: 'bad_json' })
    } finally {
      b.restore()
    }
  }
})

test('callAuthServer：常量与默认超时', () => {
  assert.equal(AUTH_SERVER_TIMEOUT_MS, 15000)
})

/* ------------------------------ 会话原语 ------------------------------ */

test('issueSession/readSession：往返一致，值带 v1 版本前缀', () => {
  assert.equal(SESSION_VERSION, 'v1')
  const s = issueSession(UID, { secret: SECRET })
  assert.equal(s.uid, UID)
  assert.equal(s.maxAgeSec, 172800)
  assert.match(s.value, /^v1\./)
  assert.equal(s.value.split('.').length, 4) // v1 . uid . iat . sig
  const back = readSession(s.value, { secret: SECRET })
  assert.deepEqual(back, { uid: UID, iat: s.iat })
  // 签名原文 = `v1.<uid>.<iat>`
  assert.equal(s.value, `v1.${UID}.${s.iat}.${hmacSign(`v1.${UID}.${s.iat}`, SECRET)}`)
})

test('issueSession：ttlSec 可覆写 maxAgeSec', () => {
  assert.equal(issueSession(UID, { secret: SECRET, ttlSec: 3600 }).maxAgeSec, 3600)
  assert.equal(issueSession(UID, { secret: SECRET, ttlSec: 0 }).maxAgeSec, 172800) // 非法回退
})

test('issueSession：uid 非法 / secret 缺失 → TypeError', () => {
  assert.throws(() => issueSession('bad.uid', { secret: SECRET }), TypeError)
  assert.throws(() => issueSession('short', { secret: SECRET }), TypeError)
  assert.throws(() => issueSession('', { secret: SECRET }), TypeError)
  assert.throws(() => issueSession(UID, {}), TypeError)
  assert.throws(() => issueSession(UID, { secret: '' }), TypeError)
})

test('readSession：错密钥 / 篡改 / 版本/形态非法 / 非串 → null（不抛错）', () => {
  const s = issueSession(UID, { secret: SECRET })
  assert.equal(readSession(s.value, { secret: 'other-secret' }), null)
  // 篡改 uid 段，签名失配
  const tampered = s.value.replace(`v1.${UID}.`, `v1.${'z'.repeat(12)}.`)
  assert.equal(readSession(tampered, { secret: SECRET }), null)
  // 版本前缀不识别
  assert.equal(readSession(s.value.replace(/^v1\./, 'v2.'), { secret: SECRET }), null)
  // 形态非法（缺 iat 段）
  const noIat = `v1.${UID}.${hmacSign(`v1.${UID}`, SECRET)}`
  assert.equal(readSession(noIat, { secret: SECRET }), null)
  assert.equal(readSession('not-a-session', { secret: SECRET }), null)
  assert.equal(readSession(null, { secret: SECRET }), null)
  assert.equal(readSession(s.value, {}), null)
  assert.equal(readSession(s.value, { secret: '' }), null)
})

test('renewIfStale：半衰期判定与边界', () => {
  const now = Math.floor(Date.now() / 1000)
  assert.equal(renewIfStale(now, {}), false) // 刚签发
  assert.equal(renewIfStale(now - 23 * 3600, {}), false) // < 24h
  assert.equal(renewIfStale(now - 24 * 3600, {}), true) // = 半衰期
  assert.equal(renewIfStale(now - 25 * 3600, {}), true) // > 半衰期
})

test('renewIfStale：halfLife 覆写 / ttlSec 上限 / 非法 iat / 未来时钟', () => {
  const now = Math.floor(Date.now() / 1000)
  assert.equal(renewIfStale(now - 2 * 3600, { halfLife: 3600 }), true)
  assert.equal(renewIfStale(now - 1800, { halfLife: 3600 }), false)
  // halfLife 超过 ttlSec 时收敛为 ttlSec：到期必续
  assert.equal(renewIfStale(now - 3600, { ttlSec: 3600, halfLife: 999999 }), true)
  assert.equal(renewIfStale(now - 3599, { ttlSec: 3600, halfLife: 999999 }), false)
  // 非法 iat → true（保守续期）
  assert.equal(renewIfStale(NaN, {}), true)
  assert.equal(renewIfStale(0, {}), true)
  assert.equal(renewIfStale(-5, {}), true)
  // 未来 iat → false（时钟偏移不误判为陈旧）
  assert.equal(renewIfStale(now + 3600, {}), false)
})

/* ------------------------------ 旧 cookie 双读 ------------------------------ */

test('readCookieValue：多项提取 / 值含 = / 百分号解码 / 缺失', () => {
  assert.equal(readCookieValue('a=1; b=2; c=3', 'b'), '2')
  assert.equal(readCookieValue('token=abc=def==', 'token'), 'abc=def==')
  assert.equal(readCookieValue('x=a%20b', 'x'), 'a b')
  assert.equal(readCookieValue('x=%', 'x'), '%') // decode 失败回原文
  assert.equal(readCookieValue('a=1', 'z'), null)
  assert.equal(readCookieValue('', 'a'), null)
  assert.equal(readCookieValue(null, 'a'), null)
})

test('readLegacySession：hmd2/hmd2w 验签通过返回 uid', () => {
  for (const name of [LEGACY_HMD_COOKIE, LEGACY_HMD_WECHAT_COOKIE]) {
    const value = `${name}.${UID}.${hmacSign(`${name}.${UID}`, SECRET)}`
    const got = readLegacySession(`${name}=${value}`, { secret: SECRET })
    assert.deepEqual(got, { source: name, kind: 'hmac', uid: UID })
  }
})

test('readLegacySession：真实 hmd 存量（cookie 名恒为 hmd2，值前缀 hmd2./hmd2w. 区分）', () => {
  for (const [prefix, source] of [
    ['hmd2', LEGACY_HMD_COOKIE],
    ['hmd2w', LEGACY_HMD_WECHAT_COOKIE],
  ]) {
    const value = `${prefix}.${UID}.${hmacSign(`${prefix}.${UID}`, SECRET)}`
    const got = readLegacySession(`${LEGACY_HMD_COOKIE}=${value}`, { secret: SECRET })
    assert.deepEqual(got, { source, kind: 'hmac', uid: UID })
  }
})

test('readLegacySession：source 恒取值前缀（cookie 名不参与判定）', () => {
  // cookie 名 hmd2w 但值前缀 hmd2 → 判为匿名前缀，微信标记以值前缀为准
  const value = `${LEGACY_HMD_COOKIE}.${UID}.${hmacSign(`${LEGACY_HMD_COOKIE}.${UID}`, SECRET)}`
  assert.deepEqual(readLegacySession(`${LEGACY_HMD_WECHAT_COOKIE}=${value}`, { secret: SECRET }), {
    source: LEGACY_HMD_COOKIE,
    kind: 'hmac',
    uid: UID,
  })
})

test('readLegacySession：hmd 系错密钥 / uid 非法 / 缺 secret → 跳过', () => {
  const value = `${LEGACY_HMD_COOKIE}.${UID}.${hmacSign(`${LEGACY_HMD_COOKIE}.${UID}`, SECRET)}`
  assert.equal(readLegacySession(`${LEGACY_HMD_COOKIE}=${value}`, { secret: 'wrong' }), null)
  assert.equal(readLegacySession(`${LEGACY_HMD_COOKIE}=${value}`, {}), null)
  const badUid = `${LEGACY_HMD_COOKIE}.x.${hmacSign(`${LEGACY_HMD_COOKIE}.x`, SECRET)}`
  assert.equal(readLegacySession(`${LEGACY_HMD_COOKIE}=${badUid}`, { secret: SECRET }), null)
})

test('readLegacySession：wi_session/fang_session 64hex token 命中', () => {
  const token = 'a'.repeat(64)
  assert.deepEqual(readLegacySession(`${LEGACY_WORDINPUT_COOKIE}=${token}`, {}), {
    source: LEGACY_WORDINPUT_COOKIE,
    kind: 'token',
    token,
  })
  assert.deepEqual(readLegacySession(`${LEGACY_FANG_COOKIE}=${token}`, {}), {
    source: LEGACY_FANG_COOKIE,
    kind: 'token',
    token,
  })
  // 非 64hex 拒绝
  assert.equal(readLegacySession(`${LEGACY_FANG_COOKIE}=${'g'.repeat(64)}`, {}), null)
  assert.equal(readLegacySession(`${LEGACY_FANG_COOKIE}=short`, {}), null)
  assert.equal(readLegacySession('', {}), null)
})

test('readLegacySession：HMAC 系优先于 token 系', () => {
  const hmd = `${LEGACY_HMD_COOKIE}.${UID}.${hmacSign(`${LEGACY_HMD_COOKIE}.${UID}`, SECRET)}`
  const header = `${LEGACY_HMD_COOKIE}=${hmd}; ${LEGACY_WORDINPUT_COOKIE}=${'b'.repeat(64)}`
  assert.deepEqual(readLegacySession(header, { secret: SECRET }), {
    source: LEGACY_HMD_COOKIE,
    kind: 'hmac',
    uid: UID,
  })
})

test('旧 cookie 名常量与遍历顺序', () => {
  assert.equal(LEGACY_HMD_COOKIE, 'hmd2')
  assert.equal(LEGACY_HMD_WECHAT_COOKIE, 'hmd2w')
  assert.equal(LEGACY_WORDINPUT_COOKIE, 'wi_session')
  assert.equal(LEGACY_FANG_COOKIE, 'fang_session')
  assert.deepEqual(LEGACY_SESSION_COOKIES, ['hmd2w', 'hmd2', 'wi_session', 'fang_session'])
})

/* ------------------------------ index 出口 ------------------------------ */

test('index 出口聚合：新 API 均已挂载', () => {
  assert.equal(index.AUTH_SERVER_TIMEOUT_MS, AUTH_SERVER_TIMEOUT_MS)
  assert.equal(index.SESSION_VERSION, SESSION_VERSION)
  assert.equal(typeof index.callAuthServer, 'function')
  assert.equal(typeof index.issueSession, 'function')
  assert.equal(typeof index.readSession, 'function')
  assert.equal(typeof index.renewIfStale, 'function')
  assert.equal(typeof index.readCookieValue, 'function')
  assert.equal(typeof index.readLegacySession, 'function')
  assert.equal(index.LEGACY_HMD_COOKIE, 'hmd2')
  assert.deepEqual(index.LEGACY_SESSION_COOKIES, LEGACY_SESSION_COOKIES)
  // 往返经 index 入口可用
  const s = index.issueSession(UID, { secret: SECRET })
  assert.deepEqual(index.readSession(s.value, { secret: SECRET }), { uid: UID, iat: s.iat })
})
