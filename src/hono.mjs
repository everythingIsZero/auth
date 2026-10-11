/**
 * hono.mjs — Hono 适配（薄层：登录逻辑在 server.mjs，框架无关）
 *
 * Hono 与 Next 同属 Web 标准（`Request`/`Response`），故适配只把 Hono 的 `Context`
 * 映射到核心的 `Request`——**不重写任何登录逻辑**。换掉 Hono 时，只要新框架也吃
 * Web `Request`/`Response`，改用 `@hxym18/auth/server` + 一行 dispatch 即可，登录逻辑零改动。
 *
 * 用法：
 *   import { Hono } from 'hono'
 *   import { createHonoAuthRoutes } from '@hxym18/auth/hono'
 *   const app = new Hono()
 *   const auth = createHonoAuthRoutes(config)
 *   // 站点自有 /api/auth/* 业务端点（如 nuantie session/device）**必须先注册**。
 *   app.get('/api/auth/session', ...)   // 站点业务端点
 *   app.post('/api/auth/device', ...)   // 站点业务端点
 *   // 一条通配（推荐）：**末位注册**——否则吞掉站点自有 /api/auth/*（core 端点之外）。
 *   app.all('/api/auth/*', (c) => auth.dispatch(c))
 *   // 或逐个挂（core 端点）：
 *   app.get('/api/auth/config', (c) => auth.config(c))
 *   app.post('/api/auth/dev-login', (c) => auth.devLogin(c))
 *   app.post('/api/auth/sso-verify', (c) => auth.ssoVerify(c))
 *   app.get('/api/auth/wx-qrcode', (c) => auth.wxQrcode(c))
 *   app.get('/api/auth/wx-poll', (c) => auth.wxPoll(c))
 *   app.post('/api/auth/weapp', (c) => auth.weappVerify(c))
 *   app.post('/api/auth/logout', (c) => auth.logout(c))
 */
import { createAuthServer } from './server.mjs'

/**
 * 装配 Hono 版 auth 路由（薄适配：Context → 核心 Request）。
 *
 * **注册顺序**：若用 catch-all（`app.all('/api/auth/*', ...)`），必须**最后注册**，
 * 或显式排除站点自有的 `/api/auth/*` 业务端点——否则会吞掉它们（历史坑 I15）。
 * @param {import('./server.mjs').AuthRoutesConfig} config 与 createAuthServer 同配置
 */
export function createHonoAuthRoutes(config) {
  const core = createAuthServer(config)
  return {
    config: () => core.config(),
    devLogin: (c) => core.devLogin(c.req.raw),
    ssoVerify: (c) => core.ssoVerify(c.req.raw),
    wxQrcode: () => core.wxQrcode(),
    wxPoll: (c) => core.wxPoll(c.req.raw),
    weappVerify: (c) => core.weappVerify(c.req.raw),
    logout: () => core.logout(),
    wxConfigured: () => core.wxConfigured(),
    /** 通配分发：`app.all('/api/auth/*', (c) => auth.dispatch(c))`（**末位注册**） */
    dispatch: (c) => core.dispatch(c.req.raw),
  }
}
