"use client";
/**
 * ui.mjs — 默认登录皮肤（React DOM，零 antd/tailwind 依赖）
 *
 * 给「不想自己画登录 UI」的站一个开箱即用的弹层：PC 出二维码、手机出配对码文字、
 * 微信内出「一键登录」按钮。全部数据来自 `useSsoLogin`，样式走内联 + CSS 变量，可覆盖。
 *
 * 不适用：小程序端（Taro weapp）——那边用 controller，不要引本文件。
 *
 * 用法：
 *   <SsoLoginModal open={open} onClose={() => setOpen(false)} caps={caps}
 *     onSuccess={() => location.reload()} />
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
  spin: { width: 26, height: 26, margin: '30px auto', border: '3px solid #eee', borderTopColor: 'var(--sso-accent, #07c160)', borderRadius: '50%', animation: 'ssospin .8s linear infinite' },
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

/** 内层面板（调用 useSsoLogin；仅在需要时挂载，避免无谓轮询） */
export function SsoLoginPanel(props) {
  const {
    caps, title = '登录', hint, devLoginLabel = '开发旁路登录（本地验证）',
    onSuccess, ...loginOpts
  } = props || {}
  const { state, startSso, refresh, devLogin } = useSsoLogin({ ...loginOpts, caps, onSuccess })
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(async () => {
    if (await copyText(state.pairCode)) setCopied(true)
  }, [state.pairCode])

  const content = []
  if (state.status === 'error') {
    content.push(h('p', { key: 'e', style: S.err }, state.error || '登录未完成'))
    content.push(h('button', { key: 'r', style: S.ghostBtn, onClick: () => refresh() }, '重试'))
  } else if (state.channel === 'wechat') {
    content.push(h('button', { key: 'w', style: S.primaryBtn, onClick: () => startSso() }, '微信一键登录'))
  } else if (state.channel === 'mobile') {
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
    content.push(
      state.qrUrl
        ? h('img', { key: 'q', src: state.qrUrl, alt: '微信登录二维码', style: S.qr })
        : h('div', { key: 'l', style: S.spacer }, '二维码加载中…'),
      h('p', { key: 'h', style: S.hint }, state.status === 'pending' ? '已扫码，请在手机上完成确认' : '请用微信扫码并关注服务号'),
    )
  }
  if (state.devLogin) {
    content.push(h('button', { key: 'd', style: S.ghostBtn, onClick: () => devLogin() }, devLoginLabel))
  }

  return h('div', null, [
    h('style', { key: 'k' }, '@keyframes ssospin{to{transform:rotate(360deg)}}'),
    h('h3', { key: 't', style: S.title }, title),
    ...content,
    hint ? h('p', { key: 'g', style: S.hint }, hint) : null,
  ])
}

/** 弹层：open=false 时不挂载（不轮询、不消费回跳） */
export function SsoLoginModal(props) {
  const { open, onClose, ...rest } = props || {}
  if (!open) return null
  return h('div', { style: S.overlay, onClick: onClose }, [
    h(
      'div',
      { key: 'card', style: S.card, onClick: (e) => e.stopPropagation() },
      [
        h('button', { key: 'x', style: S.close, onClick: onClose, 'aria-label': '关闭' }, '×'),
        h(SsoLoginPanel, { key: 'p', ...rest }),
      ],
    ),
  ])
}

export default SsoLoginModal
