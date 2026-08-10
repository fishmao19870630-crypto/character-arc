import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeWorldviewType } from '../../../shared/worldview-type.ts'

test('英文世界观分类会归一为中文', () => {
  assert.deepEqual(
    ['rule', 'species'].map((type) => normalizeWorldviewType(type, '法则')),
    ['法则', '物种']
  )
})
