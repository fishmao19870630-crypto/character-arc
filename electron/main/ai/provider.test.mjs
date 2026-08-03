import assert from 'node:assert/strict'
import test from 'node:test'

import { splitCompleteSseEvents } from './sse.ts'

test('推理流实时兼容 CRLF SSE 分隔符', () => {
  const firstChunk = 'data: {"reasoning_content":"思'
  const pending = splitCompleteSseEvents(firstChunk)
  assert.deepEqual(pending.events, [])
  assert.equal(pending.remainder, firstChunk)

  const completed = splitCompleteSseEvents(
    pending.remainder
    + '考"}\r\n\r\n'
    + 'data: {"content":"正文"}\r\n\r\n'
    + 'data: {"content":"未完成"}'
  )

  assert.deepEqual(completed.events, [
    'data: {"reasoning_content":"思考"}\r\n\r\n',
    'data: {"content":"正文"}\r\n\r\n'
  ])
  assert.equal(completed.remainder, 'data: {"content":"未完成"}')
})
