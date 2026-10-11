/**
 * tests/edge-boundary.test.mjs — Edge 边界断言（S6 / pitfalls R9）
 *
 * 运行时边界：`core.mjs` 必须可在 Edge / 浏览器直载（零 `node:crypto`）；
 * 续期回写依赖 `node:crypto` 重签，仅 Node 运行时可用，Edge 不可续期——README 必须写明。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('core.mjs 不 import node:crypto（Edge 可载）；README 声明 Edge 不可续期', () => {
  assert.doesNotMatch(readFileSync('src/core.mjs', 'utf8'), /node:crypto/)
  assert.match(readFileSync('README.md', 'utf8'), /Edge.*(不可续期|不能续期)/)
})
