/**
 * caps.test.mjs — 浏览器能力位兜底（node:test，喂假 window）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { capsFromBrowser } from '../src/caps.mjs'

const IPHONE_WX = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.49'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

test('capsFromBrowser：微信内 → isWechat/isMobile', () => {
  const c = capsFromBrowser({ navigator: { userAgent: IPHONE_WX, maxTouchPoints: 5 } })
  assert.equal(c.isWechat, true)
  assert.equal(c.isMobile, true)
})

test('capsFromBrowser：手机浏览器 → isMobile 真、isWechat 假', () => {
  const c = capsFromBrowser({ navigator: { userAgent: ANDROID_CHROME, maxTouchPoints: 5 } })
  assert.equal(c.isWechat, false)
  assert.equal(c.isMobile, true)
})

test('capsFromBrowser：PC → 都假（落 pc 通道）', () => {
  const c = capsFromBrowser({ navigator: { userAgent: WIN_CHROME, maxTouchPoints: 0 } })
  assert.equal(c.isWechat, false)
  assert.equal(c.isMobile, false)
})

test('capsFromBrowser：PWA standalone（matchMedia 或 navigator.standalone）', () => {
  const viaMatch = capsFromBrowser({ navigator: { userAgent: WIN_CHROME, maxTouchPoints: 0 }, matchMedia: () => ({ matches: true }) })
  assert.equal(viaMatch.isPwa, true)
  const viaStandalone = capsFromBrowser({ navigator: { userAgent: ANDROID_CHROME, maxTouchPoints: 5, standalone: true } })
  assert.equal(viaStandalone.isPwa, true)
})

test('capsFromBrowser：无 window 也不抛错', () => {
  const c = capsFromBrowser(undefined)
  assert.equal(c.isWechat, false)
  assert.equal(c.isMobile, false)
})
