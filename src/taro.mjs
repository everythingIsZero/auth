/**
 * taro.mjs — Taro 适配（H5 与小程序共用同一 controller）
 *
 * H5：adapter 委托 window（全域 cookie + 网页跳转），动线同 React 站。
 * 小程序：无全域 cookie/网页跳转，taroAdapter 惰性；登录走各小程序身份源，本包不介入。
 * api 需由调用方用 Taro.request 自备（小程序无标准 fetch）。
 */
import { createLoginController, taroAdapter } from './controller.mjs'

/**
 * @param {{
 *   Taro?: any, isH5?: boolean, win?: any,
 *   api: any, caps?: { isWechat?: boolean, isMobile?: boolean }, adapter?: any,
 *   authOrigin?: string, cookieName?: string,
 *   pollIntervalMs?: number, retryIntervalMs?: number,
 *   onSuccess?: (data: any) => void, onState?: (state: any) => void
 * }} opts
 */
export function createTaroLogin(opts) {
  const o = opts || {}
  if (!o.api) throw new TypeError('createTaroLogin: api is required（小程序/ Taro 用自备请求层）')
  return createLoginController({
    ...o,
    adapter: o.adapter || taroAdapter({ isH5: !!o.isH5, win: o.win }),
  })
}
