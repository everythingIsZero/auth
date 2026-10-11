/**
 * tests/core.test.mjs — @app/auth 同构层边界测试（node:test，零依赖）
 * 覆盖：票根 47/48/49 边界与 hex 大小写 / redirect 白名单放行+拦截 /
 *       SSO scene 前缀 / 常量取值 / buildAuthRedirect 编码与兜底 / index 出口聚合
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginCapsFromCapabilities } from '../src/core.mjs'

import {
  SSO_TICKET_COOKIE,
  APP_SESSION_COOKIE,
  APP_SESSION_WECHAT_COOKIE,
  SESSION_TTL_SEC,
  APP_SESSION_VALUE_RE,
  SSO_SCENE_PREFIX,
  WECHAT_PROVIDER,
  AUTH_ORIGIN,
  DEFAULT_REDIRECT,
  CLOUD_ENV_ID,
  isTicket,
  isSsoScene,
  isSessionValue,
  sessionCookieName,
  isAllowedRedirect,
  buildAuthRedirect,
} from '../src/core.mjs'
import * as index from '../src/index.mjs'

const TICKET48 = 'a'.repeat(48)

test('常量取值与存量单源一致', () => {
  assert.equal(SSO_TICKET_COOKIE, 'sl_web_session')
  assert.equal(APP_SESSION_COOKIE, 'app_session')
  assert.equal(APP_SESSION_WECHAT_COOKIE, 'app_session_w')
  assert.equal(SESSION_TTL_SEC, 172800)
  assert.equal(SSO_SCENE_PREFIX, 'ssologin-')
  assert.equal(WECHAT_PROVIDER, 'wechat')
  assert.equal(AUTH_ORIGIN, 'https://auth.hxym18.com')
  assert.equal(DEFAULT_REDIRECT, 'https://hxym18.com/')
  assert.equal(CLOUD_ENV_ID, 'cloud1-5gmlb2qmf0f1963b')
})

test('sessionCookieName：微信标记 → app_session_w，缺省 → app_session', () => {
  assert.equal(sessionCookieName(), 'app_session')
  assert.equal(sessionCookieName({}), 'app_session')
  assert.equal(sessionCookieName({ wechat: false }), 'app_session')
  assert.equal(sessionCookieName({ wechat: true }), 'app_session_w')
  assert.equal(sessionCookieName({ wechat: true }), APP_SESSION_WECHAT_COOKIE)
  assert.equal(sessionCookieName(), APP_SESSION_COOKIE)
})

test('isSessionValue：与 issueSession 产物 4 段形态一致（仅形状不验签）', () => {
  const UID = 'abcd1234-ef56'
  const ok = `v1.${UID}.1757900000.${'A'.repeat(43)}`
  assert.equal(isSessionValue(ok), true)
  assert.equal(APP_SESSION_VALUE_RE.test(ok), true)
  // 缺 sig 段（issueSession 产物恒 4 段）
  assert.equal(isSessionValue(`v1.${UID}.1757900000`), false)
  // 版本前缀不符
  assert.equal(isSessionValue(`v2.${UID}.1757900000.sig`), false)
  // uid 过短（<8）
  assert.equal(isSessionValue('v1.short.1757900000.sig'), false)
  // iat 非数字
  assert.equal(isSessionValue(`v1.${UID}.soon.sig`), false)
  // 非串
  assert.equal(isSessionValue(null), false)
  assert.equal(isSessionValue(''), false)
})

test('isTicket：48 位 hex 边界 47/48/49', () => {
  assert.equal(isTicket(TICKET48), true)
  assert.equal(isTicket('a'.repeat(47)), false)
  assert.equal(isTicket('a'.repeat(49)), false)
})

test('isTicket：大小写不敏感，非 hex 拒绝', () => {
  assert.equal(isTicket('0123456789abcdefABCDEF0123456789abcdefABCDEF0123'), true)
  assert.equal(isTicket('g'.repeat(48)), false)
  assert.equal(isTicket(`${'a'.repeat(47)}-`), false)
  assert.equal(isTicket(''), false)
  assert.equal(isTicket(null), false)
  assert.equal(isTicket(1234), false)
})

test('isSsoScene：前缀判定', () => {
  assert.equal(isSsoScene('ssologin-0123456789abcdef01234567'), true)
  assert.equal(isSsoScene('ssologin-'), true) // 与存量 startsWith 口径一致（不校验后缀）
  assert.equal(isSsoScene('hmd_entry'), false)
  assert.equal(isSsoScene('ssologin'), false)
  assert.equal(isSsoScene(''), false)
  assert.equal(isSsoScene(undefined), false)
})

test('isAllowedRedirect：放行 https 主域与子域', () => {
  assert.equal(isAllowedRedirect('https://hxym18.com/'), true)
  assert.equal(isAllowedRedirect('https://sl.hxym18.com/'), true)
  assert.equal(isAllowedRedirect('https://ka.hxym18.com/login?a=1&b=2'), true)
  assert.equal(isAllowedRedirect('https://a.b.hxym18.com/x'), true)
})

test('isAllowedRedirect：拦截 http / 外部域 / 仿冒域 / 非法值', () => {
  assert.equal(isAllowedRedirect('http://sl.hxym18.com/'), false)
  assert.equal(isAllowedRedirect('https://evil.com/'), false)
  assert.equal(isAllowedRedirect('https://notreallyhxym18.com/'), false)
  assert.equal(isAllowedRedirect('https://hxym18.com.evil.com/'), false)
  assert.equal(isAllowedRedirect('https://evil-hxym18.com/'), false)
  assert.equal(isAllowedRedirect('javascript:alert(1)'), false)
  assert.equal(isAllowedRedirect('not a url'), false)
  assert.equal(isAllowedRedirect(''), false)
  assert.equal(isAllowedRedirect(null), false)
})

test('buildAuthRedirect：白名单 URL 单次编码进 redirect 参数', () => {
  const out = buildAuthRedirect('https://ka.hxym18.com/login?a=1&b=2')
  assert.equal(out, 'https://auth.hxym18.com/?redirect=' + encodeURIComponent('https://ka.hxym18.com/login?a=1&b=2'))
  // auth 站 readRedirect 用 URLSearchParams 解一次应还原原文
  const decoded = new URL(out).searchParams.get('redirect')
  assert.equal(decoded, 'https://ka.hxym18.com/login?a=1&b=2')
})

test('buildAuthRedirect：非法/缺失 redirect 落 DEFAULT_REDIRECT', () => {
  const expected = 'https://auth.hxym18.com/?redirect=' + encodeURIComponent(DEFAULT_REDIRECT)
  assert.equal(DEFAULT_REDIRECT, 'https://hxym18.com/')
  assert.equal(buildAuthRedirect('https://evil.com/'), expected)
  assert.equal(buildAuthRedirect(undefined), expected)
  assert.equal(buildAuthRedirect(''), expected)
})

test('buildAuthRedirect：opts 可覆写 origin / fallback', () => {
  const out = buildAuthRedirect('https://evil.com/', {
    origin: 'https://auth.test',
    fallback: 'https://ka.hxym18.com/',
  })
  assert.equal(out, 'https://auth.test/?redirect=' + encodeURIComponent('https://ka.hxym18.com/'))
})

test('loginCapsFromCapabilities：@hxym18/env 能力位 → 登录通道位（唯一桥接）', () => {
  // 移动微信：isWechatMobile 真 → wechat 通道
  assert.deepEqual(
    loginCapsFromCapabilities({ isWechat: true, isWechatMobile: true, isMobile: true }),
    { isWechatInApp: true, isMobileBrowser: true }
  )
  // 桌面微信：isWechat 真但 isWechatMobile 假 → 不得判 wechat（OAuth 死路）
  assert.deepEqual(
    loginCapsFromCapabilities({ isWechat: true, isDesktopWechat: true, isWechatMobile: false, isMobile: false }),
    { isWechatInApp: false, isMobileBrowser: false }
  )
  // 小程序 webview：isWechat 真但非移动微信 → 不当 wechat 通道
  assert.deepEqual(
    loginCapsFromCapabilities({ isWechat: true, isMiniprogram: true, isMobile: true }),
    { isWechatInApp: false, isMobileBrowser: true }
  )
  // 手机浏览器 / 桌面浏览器
  assert.deepEqual(loginCapsFromCapabilities({ isMobile: true }), { isWechatInApp: false, isMobileBrowser: true })
  assert.deepEqual(loginCapsFromCapabilities({ isMobile: false }), { isWechatInApp: false, isMobileBrowser: false })
  // 缺省（漏传信号）：全 false → PC 兜底，不抛
  assert.deepEqual(loginCapsFromCapabilities(undefined), { isWechatInApp: false, isMobileBrowser: false })
  assert.deepEqual(loginCapsFromCapabilities({}), { isWechatInApp: false, isMobileBrowser: false })
})

test('index 出口聚合 core + node（node 层函数已挂载）', () => {
  assert.equal(index.SSO_TICKET_COOKIE, SSO_TICKET_COOKIE)
  assert.equal(index.APP_SESSION_COOKIE, APP_SESSION_COOKIE)
  assert.equal(index.APP_SESSION_WECHAT_COOKIE, APP_SESSION_WECHAT_COOKIE)
  assert.equal(index.sessionCookieName({ wechat: true }), APP_SESSION_WECHAT_COOKIE)
  assert.equal(index.isSessionValue('v1.abcd1234-ef56.1757900000.sig'), true)
  assert.equal(index.SESSION_TTL_SEC, SESSION_TTL_SEC)
  assert.equal(index.WECHAT_PROVIDER, WECHAT_PROVIDER)
  assert.equal(index.isTicket(TICKET48), true)
  assert.equal(index.isSsoScene('ssologin-x'), true)
  assert.equal(typeof index.sha1SignatureOk, 'function')
  assert.equal(typeof index.hmacSign, 'function')
  assert.equal(typeof index.hmacVerify, 'function')
})
