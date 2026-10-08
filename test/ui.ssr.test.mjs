/**
 * ui.ssr.test.mjs — 默认皮肤渲染冒烟（SSR；验证按端分支与挂载门控，不触网）
 * useEffect 在 SSR 不执行，故 controller 不启动；这里只验初始渲染形态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SsoLoginModal, SsoLoginPanel } from '../src/ui.mjs'

test('ui：open=false 不渲染', () => {
  const html = renderToStaticMarkup(React.createElement(SsoLoginModal, { open: false }))
  assert.equal(html, '')
})

test('ui：微信内 → 一键登录按钮', () => {
  const html = renderToStaticMarkup(
    React.createElement(SsoLoginModal, { open: true, caps: { isWechat: true, isMobile: true } }),
  )
  assert.match(html, /微信一键登录/)
  assert.match(html, /aria-label="关闭"/)
})

test('ui：PC → 二维码区 + 扫码提示', () => {
  const html = renderToStaticMarkup(React.createElement(SsoLoginPanel, { caps: { isWechat: false, isMobile: false } }))
  assert.match(html, /二维码加载中/)
  assert.match(html, /请用微信扫码/)
})

test('ui：title 可覆盖', () => {
  const html = renderToStaticMarkup(
    React.createElement(SsoLoginPanel, { caps: { isWechat: false, isMobile: false }, title: '扫码登录' }),
  )
  assert.match(html, /扫码登录/)
})
