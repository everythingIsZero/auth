"use client";
/**
 * ui.mjs — 默认登录皮肤（React DOM，零 antd/tailwind 依赖）
 *
 * 三个导出，按「需要多少」选用：
 *   - `SsoLoginView`  纯视图：吃 `state` + 动作，**不打电话**。可被任意 state 渲染/测试，
 *                     也供「已自持登录状态」的站复用。
 *   - `SsoLoginPanel` 自带 `useSsoLogin` 的面板（turnkey）。
 *   - `SsoLoginModal` 弹层（覆盖 + 关闭 + 面板）。
 *
 * 按端显示：微信内=一键登录按钮；手机浏览器=配对码文字；PC=二维码。
 * 不适用：小程序端（Taro weapp）——那边用 controller，不要引本文件。
 */
import { createElement as h, useCallback, useState } from 'react'
import { useSsoLogin } from './react.mjs'

const S = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
  },
  card: {
    width: '100%', maxWidth: 360, background: 'var(--sso-bg, #fff)',
    color: 'var(--sso-fg, #1a1a1a)', borderRadius: 14,
    boxShadow: '0 12px 40px rgba(0,0,0,.18)', padding: '20px 20px 18px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif',
    textAlign: 'center', position: 'relative',
  },
  close: {
    position: 'absolute', top: 8, right: 10, border: 'none', background: 'transparent',
    fontSize: 20, lineHeight: '20px', color: '#9aa', cursor: 'pointer', padding: 4,
  },
  title: { fontSize: 16, fontWeight: 600, margin: '2px 0 14px' },
  primaryBtn: {
    width: '100%', padding: '11px 16px', fontSize: 15, color: '#fff', cursor: 'pointer',
    background: 'var(--sso-accent, #07c160)', border: 'none', borderRadius: 10,
  },
  ghostBtn: {
    width: '100%', marginTop: 10, padding: '9px 16px', fontSize: 14, cursor: 'pointer',
    color: 'var(--sso-accent, #07c160)', background: 'transparent',
    border: '1px solid var(--sso-accent, #07c160)', borderRadius: 999,
  },
  qr: { width: 220, height: 220, display: 'block', margin: '4px auto 10px', borderRadius: 10, background: '#f6f6f6' },
  pair: { fontSize: 34, fontWeight: 700, letterSpacing: '.22em', color: 'var(--sso-accent, #07c160)', margin: '8px 0 12px' },
  hint: { fontSize: 13, color: '#888', lineHeight: 1.6, margin: '6px 0 0' },
  err: { fontSize: 14, color: '#d4380d', margin: '10px 0 4px' },
  spacer: { height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13 },
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/**
 * 纯视图：只按 `state` 渲染 + 调回调，不建立连接。
 * @param {{
 *   state: { channel:'wechat'|'mobile'|'pc', status:string, qrUrl?:string, pairCode?:string, error?:string, devLogin?:boolean },
 *   startSso?: () => void, refresh?: () => void, devLogin?: () => void,
 *   title?: string, hint?: string, devLoginLabel?: string
 * }} props
 */
export function SsoLoginView(props) {
  const {
    state, startSso, refresh, devLogin,
    title = '登录', hint, devLoginLabel = '开发旁路登录（本地验证）',
  } = props || {}
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    if (await copyText(state.pairCode)) setCopied(true)
  }, [state.pairCode])

  const content = []
  if (state.status === 'error') {
    content.push(h('p', { key: 'e', style: S.err }, state.error || '登录未完成'))
    content.push(h('button', { key: 'r', style: S.ghostBtn, onClick: () => refresh && refresh() }, '重试'))
  } else if (state.channel === 'wechat') {
    content.push(h('button', { key: 'w', style: S.primaryBtn, onClick: () => startSso && startSso() }, '微信一键登录'))
  } else if (state.channel === 'mobile') {
    // 手机浏览器：无法扫自己屏幕上的码 → 出 6 位配对码文字
    content.push(
      state.pairCode
        ? h('div', { key: 'p' }, [
            h('div', { key: 'c', style: S.pair }, state.pairCode),
            h('button', { key: 'cp', style: S.primaryBtn, onClick: onCopy }, copied ? '已复制 ✓' : '复制数字'),
            h('p', { key: 'h', style: S.hint }, '打开微信，把这个数字发给服务号（没关注就先关注），回到本页自动登录。'),
          ])
        : h('div', { key: 'l', style: S.spacer }, '正在生成登录码…'),
    )
  } else {
    // PC：二维码
    content.push(
      state.qrUrl
        ? h('img', { key: 'q', src: state.qrUrl, alt: '微信登录二维码', style: S.qr })
        : h('div', { key: 'l', style: S.spacer }, '二维码加载中…'),
      h('p', { key: 'h', style: S.hint }, state.status === 'pending' ? '已扫码，请在手机上完成确认' : '请用微信扫码并关注服务号'),
    )
  }
  if (state.devLogin) {
    content.push(h('button', { key: 'd', style: S.ghostBtn, onClick: () => devLogin && devLogin() }, devLoginLabel))
  }

  return h('div', null, [
    h('style', { key: 'k' }, '@keyframes ssospin{to{transform:rotate(360deg)}}'),
    h('h3', { key: 't', style: S.title }, title),
    ...content,
    hint ? h('p', { key: 'g', style: S.hint }, hint) : null,
  ])
}

/** 自带 useSsoLogin 的面板（turnkey）；仅在未注入 login 时才挂 hook */
function SsoLoginPanelWithHook(props) {
  const { caps, title = '登录', hint, devLoginLabel, onSuccess, ...loginOpts } = props || {}
  const use = useSsoLogin({ ...loginOpts, caps, onSuccess })
  return h(SsoLoginView, { state: use.state, startSso: use.startSso, refresh: use.refresh, devLogin: use.devLogin, title, hint, devLoginLabel })
}

/** 面板：传 `login` 时**只渲染纯视图**（不建连接、不轮询） */
export function SsoLoginPanel(props) {
  const { login, title, hint, devLoginLabel, ...rest } = props || {}
  if (login) return h(SsoLoginView, { ...login, title, hint, devLoginLabel })
  return h(SsoLoginPanelWithHook, { title, hint, devLoginLabel, ...rest })
}

/** 弹层：open=false 不挂载（不轮询、不消费回跳） */
export function SsoLoginModal(props) {
  const { open, onClose, ...rest } = props || {}
  if (!open) return null
  return h('div', { style: S.overlay, onClick: onClose }, [
    h('div', { key: 'card', style: S.card, onClick: (e) => e.stopPropagation() }, [
      h('button', { key: 'x', style: S.close, onClick: onClose, 'aria-label': '关闭' }, '×'),
      h(SsoLoginPanel, { key: 'p', ...rest }),
    ]),
  ])
}

export default SsoLoginModal
