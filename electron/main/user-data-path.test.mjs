import assert from 'node:assert/strict'
import test from 'node:test'
import { join, resolve } from 'node:path'

import { resolveUserDataPath } from './user-data-path.ts'

test('开发环境使用独立数据目录', () => {
  assert.deepEqual(resolveUserDataPath('C:\\AppData', false, undefined), {
    path: join('C:\\AppData', 'CharacterArc-Dev'),
    isOverride: false
  })
})

test('打包环境保持正式数据目录并支持显式覆盖', () => {
  assert.equal(resolveUserDataPath('C:\\AppData', true, undefined).path, join('C:\\AppData', 'CharacterArc'))
  assert.deepEqual(resolveUserDataPath('C:\\AppData', false, 'D:\\Temp\\CharacterArc-Test'), {
    path: resolve('D:\\Temp\\CharacterArc-Test'),
    isOverride: true
  })
})
