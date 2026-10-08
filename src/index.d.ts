/**
 * index.d.ts — @app/auth 类型出口（re-export；含 node 层，仅 Node 运行时）
 *
 * Edge / 浏览器消费方直接从 core 取类型（不 import 本 index）。
 */
export * from './core'
export * from './node'
