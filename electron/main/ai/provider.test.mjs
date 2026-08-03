import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AiStreamProtocolError,
  createTerminalAwareSseStream,
  fetchWithResponseStartTimeout,
  isAiStreamIdleTimeoutError,
  isTerminalSseEvent,
  readStreamChunkWithIdleTimeout,
  splitCompleteSseEvents,
  takeSseEventsThroughTerminal
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

test('等待响应头超时不会永久卡在请求阶段', async () => {
  const neverResponds = () => new Promise(() => {})

  await assert.rejects(
    fetchWithResponseStartTimeout(neverResponds, 'https://example.test', undefined, 10),
    (error) => isAiStreamIdleTimeoutError(error) && /等待响应/.test(error.message)
  )
})

test('识别兼容接口的流式终止事件，不依赖上游关闭连接', () => {
  assert.equal(isTerminalSseEvent('data: [DONE]\n\n'), true)
  assert.equal(isTerminalSseEvent('event: message_stop\ndata: {"type":"message_stop"}\n\n'), true)
  assert.equal(isTerminalSseEvent('event: response.completed\ndata: {"type":"response.completed"}\n\n'), true)
  assert.equal(isTerminalSseEvent('data: {"type":"response.failed"}\n\n'), true)
  assert.equal(isTerminalSseEvent('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'), false)
})

test('关闭流前保留终止事件之前的全部正文事件', () => {
  const contentOne = 'event: content_block_delta\ndata: {"delta":{"text":"完整"}}\n\n'
  const contentTwo = 'event: content_block_delta\ndata: {"delta":{"text":"回答"}}\n\n'
  const terminal = 'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  const invalidTail = ': keep-alive\n\n'

  assert.deepEqual(takeSseEventsThroughTerminal([
    contentOne,
    contentTwo,
    terminal,
    invalidTail
  ]), {
    events: [contentOne, contentTwo, terminal],
    terminalSeen: true
  })
})

test('收到终止事件后完整转发正文且不等待上游关闭连接', async () => {
  const encoder = new TextEncoder()
  let upstreamCanceled = false
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"你"}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"好，完整回答"}\n\n'))
      controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{}}\n\n'))
    },
    cancel() {
      upstreamCanceled = true
    }
  })

  const output = await new Response(createTerminalAwareSseStream(source, 100)).text()

  assert.match(output, /"delta":"你"/)
  assert.match(output, /"delta":"好，完整回答"/)
  assert.match(output, /"type":"response.completed"/)
  assert.equal(upstreamCanceled, true)
})

test('上游未发送终止事件时拒绝把部分正文标记为完成', async () => {
  const encoder = new TextEncoder()
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"部分正文"}}]}\n\n'))
      controller.close()
    }
  })

  await assert.rejects(
    new Response(createTerminalAwareSseStream(source, 100)).text(),
    (error) => error instanceof AiStreamProtocolError
  )
})
