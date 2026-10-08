/**
 * ui.ssr.test.mjs — 默认皮肤渲染测试（SSR；覆盖**每个终端分支**，不触网）
 * 用纯视图 SsoLoginView 喂不同 state，验证按端渲染正确（含手机配对码）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SsoLoginModal, SsoLoginPanel, SsoLoginView } from '../src/ui.mjs'

const render = (el) => renderToStaticMarkup(el)
const view = (state, extra) => render(React.createElement(SsoLoginView, { state, ...extra }))

test('ui：open=false 不渲染（不挂载、不轮询）', () => {
  assert.equal(render(React.createElement(SsoLoginModal, { open: false })), '')
})

test('ui/wechat：微信内 → 一键登录按钮', () => {
  const html = view({ channel: 'wechat', status: 'idle' })
  assert.match(html, /微信一键登录/)
})

test('ui/mobile：手机浏览器 → 配对码文字 + 复制按钮 + 服务号提示', () => {
  const html = view({ channel: 'mobile', status: 'waiting', pairCode: '042031' })
  assert.match(html, /042031/)
  assert.match(html, /复制数字/)
  assert.match(html, /发给服务号/)
})

test('ui/mobile：配对码未就绪 → 生成中占位', () => {
  const html = view({ channel: 'mobile', status: 'waiting' })
  assert.match(html, /正在生成登录码/)
})

test('ui/pc：二维码 + 扫码提示；pending 文案区分', () => {
  const waiting = view({ channel: 'pc', status: 'waiting', qrUrl: 'https://mp.weixin.qq.com/x' })
  assert.match(waiting, /微信登录二维码/)
  assert.match(waiting, /请用微信扫码/)
  const pending = view({ channel: 'pc', status: 'pending', qrUrl: 'https://mp.weixin.qq.com/x' })
  assert.match(pending, /已扫码/)
})

test('ui/pc：二维码未就绪 → 加载占位', () => {
  assert.match(view({ channel: 'pc', status: 'waiting' }), /二维码加载中/)
})

test('ui/error：错误文案 + 重试按钮', () => {
  const html = view({ channel: 'pc', status: 'error', error: '微信登录暂未开通' })
  assert.match(html, /微信登录暂未开通/)
  assert.match(html, /重试/)
})

test('ui：devLogin 开启时显示旁路按钮（文案可覆盖）', () => {
  const html = view({ channel: 'pc', status: 'waiting', devLogin: true }, { devLoginLabel: '本地登录' })
  assert.match(html, /本地登录/)
})

test('ui：title 可覆盖', () => {
  assert.match(view({ channel: 'pc', status: 'waiting' }, { title: '扫码登录' }), /扫码登录/)
})

test('ui：SsoLoginModal 打开 → 覆盖层 + 关闭按钮 + 面板', () => {
  const html = render(React.createElement(SsoLoginModal, { open: true, caps: { isWechat: true, isMobile: true } }))
  assert.match(html, /aria-label="关闭"/)
  assert.match(html, /微信一键登录/)
})

test('ui：SsoLoginPanel 可用外部 login 注入（不新建控制器）', () => {
  const login = { state: { channel: 'mobile', status: 'waiting', pairCode: '999888' } }
  const html = render(React.createElement(SsoLoginPanel, { login }))
  assert.match(html, /999888/)
})
