/**
 * next.mjs — Next.js App Router 适配（薄层：登录逻辑在 server.mjs，框架无关）
 *
 * 换框架不改登录逻辑：核心 `createAuthServer`（Web Request → Response）写一次；
 *   - Next：本文件（出口名 `createAuthRoutes`）
 *   - Hono：`@hxym18/auth/hono`
 *   - 其他 Web 标准框架：`@hxym18/auth/server` + 一行 dispatch（Express 经 req/res↔Request/Response 桥接）。
 *     注：核心运行时限 Node（`node:crypto` 签会话）；Cloudflare Workers 等需自备签名。
 *
 * 各站最小接入：
 *   // src/app/api/auth/[action]/route.ts —— 一个文件覆盖全部 auth 端点
 *   import { routes } from '@/lib/auth-routes'
 *   export const GET = routes.dispatch
 *   export const POST = routes.dispatch
 */
export { ANCHORS, createAuthServer as createAuthRoutes, getSession } from './server.mjs'
