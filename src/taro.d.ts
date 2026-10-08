import type { LoginCaps, LoginApi, LoginAdapter, LoginController } from './controller'

export interface CreateTaroLoginOptions {
  Taro?: any
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
