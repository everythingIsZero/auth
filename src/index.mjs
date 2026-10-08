/**
 * index.mjs — @app/auth 公共出口（re-export）
 *
 * 注意：本出口含 node.mjs（node:crypto），仅 Node 运行时可用。
 * Edge / 浏览器消费方应从 core.mjs 取同构常量与纯函数（不 import 本 index）。
 */
export * from './core.mjs'
export * from './node.mjs'
