import type { LoginCaps, LoginApi, LoginAdapter, LoginController } from './controller'

export interface CreateTaroLoginOptions {
  isH5?: boolean
  win?: any
  api: LoginApi
  caps?: LoginCaps
  adapter?: LoginAdapter
  authOrigin?: string
  cookieName?: string
  pollIntervalMs?: number
  retryIntervalMs?: number
  onSuccess?: (data: any) => void
  onState?: (state: any) => void
}

export function createTaroLogin(opts: CreateTaroLoginOptions): LoginController

/** Taro 版 api 工厂（同 controller 出口，便于一处引入） */
export { createTaroApi } from './controller'

/** 小程序登录接线：Taro.login 取 code → 站点端点换会话 → 存 token；通道故障不清已有 token */
export declare function createWeappLogin(opts: {
  /** 传 Taro 对象（本包不依赖 @tarojs/taro） */
  Taro: { login?: () => Promise<{ code?: string }> }
  /** 站点端点：POST /api/auth/weapp {code} → { token } | { data:{token} } */
  request: (code: string) => Promise<any>
  /** 可选：落 token（如 Taro.setStorageSync） */
  store?: { set: (token: string) => void }
}): () => Promise<boolean>

/**
 * 小程序资料采集接线：临时头像文件 → 上传 → 归一资料（昵称空回退「微信用户」）。
 * UI（`button open-type="chooseAvatar"` + `<input type="nickname">`）由站点自绘。
 */
export declare function createWeappProfile(opts: {
  upload: (filePath: string) => Promise<string>
}): {
  save(input: { avatarFilePath?: string; nickname?: string }): Promise<{ nickname: string; avatar: string }>
}
