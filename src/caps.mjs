/**
 * caps.mjs — 从浏览器环境推导能力位（供 useSsoLogin 在未显式传 caps 时兜底）
 *
 * 为什么：登录按端分流依赖 caps（isWechat/isMobile）。若各站忘了传，就会默认成 PC——
 * 这正是「每次手写会漏终端」的典型。这里给浏览器侧一个**零参数兜底**，判定仍单一来源于
 * `@hxym18/env`（不在本包重写 UA 逻辑）。
 */
import { capabilities } from '@hxym18/env'

/**
 * 由浏览器 window 推导能力位。
 * @param {any} win window（或等价对象，便于测试）
 */
export function capsFromBrowser(win) {
  const nav = (win && win.navigator) || {}
  let standalone = nav.standalone === true
  if (!standalone && win && typeof win.matchMedia === 'function') {
    try {
      standalone = win.matchMedia('(display-mode: standalone)').matches === true
    } catch {
      /* 隐私模式等：忽略 */
    }
  }
  return capabilities({
    ua: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    hasStandaloneDisplayMode: standalone,
  })
}
