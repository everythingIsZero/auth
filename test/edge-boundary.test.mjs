/**
 * tests/edge-boundary.test.mjs — Edge 边界断言（S6 / pitfalls R9）
 *
 * 运行时边界：`core.mjs` 必须可在 Edge / 浏览器直载（零 Node 密码学模块）；
 * 续期回写依赖 Node 密码学原语重签，仅 Node 运行时可用，Edge 不可续期——README 必须写明。
 *
 * 路径基于本模块目录解析（`import.meta.url`），故从任意 CWD 运行都成立。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('core.mjs 不 import node:crypto（Edge 可载）；README 声明 Edge 不可续期', () => {
  // 加宽匹配 `crypto` / `node:crypto`（防裸 specifier `import ... from 'crypto'` 绕过）
  assert.doesNotMatch(readFileSync(new URL('../src/core.mjs', import.meta.url), 'utf8'), /(node:)?crypto/)
  assert.match(readFileSync(new URL('../README.md', import.meta.url), 'utf8'), /Edge.*(不可续期|不能续期)/)
})
