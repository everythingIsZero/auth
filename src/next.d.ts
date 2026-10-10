/**
 * next.d.ts — Next.js 出口（薄层，类型与核心同源）
 */
export {
  ANCHORS,
  createAuthServer as createAuthRoutes,
  getSession,
} from './server'
export type { ResolveIdentity, AuthRoutesConfig, AuthRoutes } from './server'
