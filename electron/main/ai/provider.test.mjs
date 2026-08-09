import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AiStreamProtocolError,
  createProviderTransportFetch,
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

test('Provider 默认等待首响应和流数据，不按时间主动中止', async () => {
  const requestFetch = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const stream = new ReadableStream({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n'))
        controller.close()
      }
    })
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream' }
    })
  }

  const response = await createProviderTransportFetch(requestFetch)('https://example.test')
  assert.match(await response.text(), /完成/)
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
  assert.equal(isTerminalSseEvent('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'), true)
  assert.equal(isTerminalSseEvent('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'), true)
  assert.equal(isTerminalSseEvent('data: {"choices":[{"delta":{"content":"继续"},"finish_reason":null}]}\n\n'), false)
  assert.equal(isTerminalSseEvent('event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n'), false)
})

test('Provider transport 不改写 reasoning 与工具调用事件', async () => {
  const payload = [
    'data: {"choices":[{"delta":{"reasoning_content":"先读取人物卡"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_project_data","arguments":"{}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'
  ].join('')
  const requestFetch = async () => new Response(payload, {
    headers: { 'content-type': 'text/event-stream' }
  })

  const response = await createProviderTransportFetch(requestFetch, 100, 100)(
    'https://opencode.test/zen/v1/chat/completions'
  )

  assert.equal(await response.text(), payload)
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

test('SSE 事件跨多个网络分片时继续读取直到事件完整', async () => {
  const encoder = new TextEncoder()
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"con'))
      controller.enqueue(encoder.encode('tent":"分片正文"}}]}'))
      controller.enqueue(encoder.encode('\n\ndata: [DO'))
      controller.enqueue(encoder.encode('NE]\n\n'))
    }
  })

  const output = await new Response(createTerminalAwareSseStream(source, 100)).text()

  assert.match(output, /分片正文/)
  assert.match(output, /\[DONE\]/)
})

test('Chat Completions 有 finish_reason 时不强制等待 DONE', async () => {
  const encoder = new TextEncoder()
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"完整正文"},"finish_reason":null}]}\n\n'))
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'))
    }
  })

  const output = await new Response(createTerminalAwareSseStream(source, 100)).text()

  assert.match(output, /完整正文/)
  assert.match(output, /"finish_reason":"stop"/)
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
