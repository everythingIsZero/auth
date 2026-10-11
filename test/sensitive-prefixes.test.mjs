/**
 * tests/sensitive-prefixes.test.mjs — S1 契约常量边界（node:test，零依赖）
 *
 * auth 自身所有响应已 no-store；`SENSITIVE_PREFIXES` 是给**跨包门禁核对**用的契约常量
 * （workspace `scripts/e2e/prefix-consistency.test.mjs`），不驱动运行期行为。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SENSITIVE_PREFIXES } from '../src/core.mjs'
import * as index from '../src/index.mjs'

const REQUIRED = ['/s/', '/r/', '/api/']

test('SENSITIVE_PREFIXES：契约常量含全部必需项（不得少于必需项）', () => {
  assert.ok(Array.isArray(SENSITIVE_PREFIXES))
  for (const p of REQUIRED) assert.ok(SENSITIVE_PREFIXES.includes(p), `缺必需前缀 ${p}`)
})

test('SENSITIVE_PREFIXES：经 index 出口可见，且被冻结', () => {
  assert.deepEqual([...index.SENSITIVE_PREFIXES], [...SENSITIVE_PREFIXES])
  assert.ok(Object.isFrozen(SENSITIVE_PREFIXES))
})
