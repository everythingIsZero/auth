/**
 * hono.d.ts — Hono 适配的类型（薄层）
 */
import type { AuthRoutesConfig } from './server'

/** 最小 Hono Context 结构（本包不依赖 hono，避免为其加依赖） */
export interface HonoContextLike {
  req: { raw: Request }
}

export type HonoAuthRoutes = {
  ssoVerify: (c: HonoContextLike) => Promise<Response>
  wxQrcode: (c?: HonoContextLike) => Promise<Response>
  wxPoll: (c: HonoContextLike) => Promise<Response>
  weappVerify: (c: HonoContextLike) => Promise<Response>
  logout: (c?: HonoContextLike) => Promise<Response>
  wxConfigured: () => boolean
  dispatch: (c: HonoContextLike) => Promise<Response>
}

/**
 * 装配 Hono 版 auth 路由（薄适配：Context → 核心 Request）。
 * 与 `createAuthServer` 同配置。
 */
export declare function createHonoAuthRoutes(config: AuthRoutesConfig): HonoAuthRoutes
