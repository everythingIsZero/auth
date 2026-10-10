/**
 * taro.mjs — Taro 适配（H5 与小程序共用同一 controller）
 *
 * H5：adapter 委托 window（全域 cookie + 网页跳转），动线同 React 站。
 * 小程序：无全域 cookie/网页跳转，taroAdapter 惰性；登录走各小程序身份源，本包不介入。
 * api 需由调用方用 Taro.request 自备——用 `createTaroApi({ request })` 接线，不必手写五个端点。
 */
import { createLoginController, taroAdapter } from './controller.mjs'
import { profileFallback } from './core.mjs'

// 与 createTaroLogin 同出口，方便 Taro 侧一处引入。
export { createTaroApi } from './controller.mjs'

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

/**
 * 小程序（weapp/tt）登录接线：`Taro.login()` 取 code → 站点端点换会话 → 存 token。
 * 服务端换码用 `@hxym18/auth/node` 的 `exchangeWeappCode`（本函数只管客户端动线）。
 *
 * 边界（血泪）：通道故障**绝不清已有 token**（瞬时失败清 token 会让设备身份漂移）；
 * 只有明确拿不到新 token 才返回 false。
 *
 * @param {{
 *   Taro: any,                                   // 传 Taro 对象（本包不依赖 @tarojs/taro）
 *   request: (code: string) => Promise<any>,     // 站点端点：POST /api/auth/weapp {code} → { token } | { data:{token} }
 *   store?: { set: (token: string) => void }      // 可选：落 token（如 Taro.setStorageSync）
 * }} opts
 * @returns {() => Promise<boolean>}
 */
export function createWeappLogin(opts) {
  const o = opts || {}
  if (!o.Taro || typeof o.Taro !== 'object') {
    throw new TypeError('createWeappLogin: Taro is required（传 Taro 对象）')
  }
  if (typeof o.request !== 'function') {
    throw new TypeError('createWeappLogin: request is required（站点端点调用）')
  }
  const store = o.store || null
  return async function weappLogin() {
    // H5 / 无 login 能力的端：静默 false、不抛——同一份接线可跨端加载（H5 只用 createTaroLogin）
    if (typeof o.Taro.login !== 'function') return false
    let code
    try {
      const r = await o.Taro.login()
      code = r && r.code
    } catch {
      return false
    }
    if (!code) return false
    let data
    try {
      data = await o.request(code)
    } catch {
      return false // 通道故障：不清已有 token
    }
    const token = data && (data.token != null ? data.token : data.data && data.data.token)
    if (!token) return false
    if (store && typeof store.set === 'function') store.set(token)
    return true
  }
}

/**
 * 小程序资料采集接线：微信**不允许**自动拿真实昵称/头像，只能用户主动填
 * （UI 用 `<button open-type="chooseAvatar">` + `<input type="nickname">`——现行唯一合法入口）。
 * 本函数只负责「临时头像文件 → 上传 → 归一资料」；UI 由站点自绘。
 *
 * @param {{ upload: (filePath: string) => Promise<string> }} opts upload：头像临时路径 → 可访问 URL（站点存储）
 * @returns {{ save: (input: { avatarFilePath?: string, nickname?: string }) => Promise<{ nickname: string, avatar: string }> }}
 */
export function createWeappProfile(opts) {
  const o = opts || {}
  if (typeof o.upload !== 'function') {
    throw new TypeError('createWeappProfile: upload is required（头像临时路径 → URL 的站点上传）')
  }
  return {
    async save(input) {
      const i = input || {}
      let avatar = ''
      if (typeof i.avatarFilePath === 'string' && i.avatarFilePath) {
        avatar = (await o.upload(i.avatarFilePath)) || ''
      }
      return profileFallback({ nickname: i.nickname, avatar })
    },
  }
}
