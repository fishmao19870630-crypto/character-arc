import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isAiStreamIdleTimeoutError,
  readStreamChunkWithIdleTimeout,
  splitCompleteSseEvents
} from './sse.ts'

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

test('SSE 长时间没有新数据时返回可识别的空闲超时', async () => {
  const stream = new ReadableStream({ start() {} })
  const reader = stream.getReader()

  await assert.rejects(
    readStreamChunkWithIdleTimeout(reader, 10),
    (error) => isAiStreamIdleTimeoutError(error)
  )
  await reader.cancel()
})
