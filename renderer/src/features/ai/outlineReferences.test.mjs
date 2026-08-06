import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveOutlineReferenceIds } from './outlineReferences.ts'

const characters = [
  { id: 'character-lin', name: '林澈' },
  { id: 'character-qiao', name: '乔知夏' }
]

test('大纲关联候选支持真实 ID、角色名和对象格式', () => {
  assert.deepEqual(
    resolveOutlineReferenceIds([
      'character-lin',
      '乔知夏',
      { id: 'character-lin', name: '林澈' }
    ], characters),
    ['character-lin', 'character-qiao']
  )
})

test('模型未返回关联数组时从大纲正文识别明确出现的角色', () => {
  assert.deepEqual(
    resolveOutlineReferenceIds([], characters, '林澈在雨夜追查旧案，迫使乔知夏改变计划。'),
    ['character-lin', 'character-qiao']
  )
})

test('正文未提及角色时不会绑定无关角色', () => {
  assert.deepEqual(resolveOutlineReferenceIds([], characters, '守城军开始封锁港口。'), [])
})
