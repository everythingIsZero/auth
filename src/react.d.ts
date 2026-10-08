import type { LoginCaps, LoginApi, LoginAdapter, LoginState } from './controller'

export interface UseSsoLoginOptions {
  caps?: LoginCaps
  authOrigin?: string
  cookieName?: string
  adapter?: LoginAdapter
  api?: LoginApi
  fetchImpl?: typeof fetch
  qrcodeUrl?: string
  pollUrl?: string
  verifyUrl?: string
  configUrl?: string
  devLoginUrl?: string
  pollIntervalMs?: number
  retryIntervalMs?: number
  onSuccess?: (data: any) => void
}

export function useSsoLogin(opts?: UseSsoLoginOptions): {
  state: LoginState
  startSso: () => void
  refresh: () => Promise<void> | undefined
  devLogin: () => Promise<boolean> | undefined
}
