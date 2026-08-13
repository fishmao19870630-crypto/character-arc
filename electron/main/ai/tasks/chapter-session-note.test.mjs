import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { getStructuredTaskSchema } from './object-schemas.ts'

const registrySource = readFileSync(new URL('index.ts', import.meta.url), 'utf8')
const orchestratorSource = readFileSync(new URL('../runtime/orchestrator.ts', import.meta.url), 'utf8')

test('写作日志任务具备处理器、流式入口和结构化输出 schema', () => {
  assert.match(registrySource, /register\(chapterSessionNote\)/)
  assert.match(orchestratorSource, /task\.task !== 'chapter-session-note'/)

  const schema = getStructuredTaskSchema('chapter-session-note')
  assert.ok(schema)
  assert.equal(schema.safeParse({
    sessionNote: {
      craftDecisions: '用对白推进信息',
      effectiveReferences: '场景节奏技巧',
      nextChapterAdvice: '承接本章结尾的角色决定'
    }
  }).success, true)
})
