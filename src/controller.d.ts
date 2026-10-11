/**
 * 登录通道能力位。由 `@hxym18/auth/core` 的 `loginCapsFromCapabilities(env.capabilities())` 投影而来
 * ——**不要**把 `@hxym18/env` 的 Capabilities 直接透传（`isWechat` 含桌面微信/小程序 webview，会串通道）。
 */
export interface LoginCaps {
  /** 移动微信内置浏览器 → channel `'wechat'`（整页跳门面 OAuth 静默授权）。桌面微信/小程序 webview 必须为 false */
  isWechatInApp?: boolean
  /** 移动浏览器（非微信）→ channel `'mobile'`（出配对码，用户发服务号） */
  isMobileBrowser?: boolean
}

export interface LoginAdapter {
  readCookie(name: string): string
  currentUrl(): string
  replaceUrl(url: string): void
  navigate(url: string): void
  setTimeout(fn: () => void, ms: number): any
  clearTimeout(id: any): void
}

export interface LoginApi {
  config(): Promise<any>
  qrcode(): Promise<any>
  poll(scene: string): Promise<any>
  verify(body: { ticket: string }): Promise<any>
  devLogin(): Promise<any>
}

export type LoginStatus = 'idle' | 'waiting' | 'pending' | 'ok' | 'error' | 'verifying'

export interface LoginState {
  channel: 'wechat' | 'mobile' | 'pc'
  status: LoginStatus
  qrUrl: string
  pairCode: string
  error: string
  wxEnabled: boolean | null
  devLogin: boolean
  user: any
}

export interface LoginController {
  getState(): LoginState
  consumeReturn(): Promise<boolean>
  start(): Promise<void>
  startSso(): void
  refresh(): Promise<void>
  devLogin(): Promise<boolean>
  dispose(): void
}

export interface LoginControllerOptions {
  adapter: LoginAdapter
  api: LoginApi
  caps?: LoginCaps
  authOrigin?: string
  cookieName?: string
  pollIntervalMs?: number
  retryIntervalMs?: number
  onSuccess?: (data: any) => void
  onState?: (state: LoginState) => void
}

export function createLoginController(opts: LoginControllerOptions): LoginController
export function createFetchApi(opts?: {
  fetchImpl?: typeof fetch
  qrcodeUrl?: string
  pollUrl?: string
  verifyUrl?: string
  configUrl?: string
  devLoginUrl?: string
}): LoginApi
/** Taro 版 api：注入 Taro.request 形状的 request，本包不依赖 @tarojs/taro */
export function createTaroApi(opts: {
  request: (opts: {
    url: string
    method: string
    header: Record<string, string>
    data?: any
  }) => Promise<{ statusCode?: number; data?: any }>
  qrcodeUrl?: string
  pollUrl?: string
  verifyUrl?: string
  configUrl?: string
  devLoginUrl?: string
}): LoginApi
export function browserAdapter(win?: any): LoginAdapter

/**
 * Taro 适配。以「有无 window」判定终端：有 window 委托 `browserAdapter`，无 window（weapp）惰性。
 * @param opts.isH5 已废弃、被忽略（保留仅为旧调用不报错）
 */
export function taroAdapter(opts?: { win?: any; isH5?: boolean }): LoginAdapter
