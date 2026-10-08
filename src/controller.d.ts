export interface LoginCaps {
  isWechat?: boolean
  isMobile?: boolean
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
export function browserAdapter(win?: any): LoginAdapter
export function taroAdapter(opts?: { isH5?: boolean; win?: any }): LoginAdapter
