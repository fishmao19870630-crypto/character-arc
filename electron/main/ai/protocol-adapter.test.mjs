import assert from 'node:assert/strict'
import test from 'node:test'

import { stepCountIs, streamText, tool } from 'ai'
import { z } from 'zod'
import { createProtocolModel } from './protocol-adapter.ts'

function sseResponse(events) {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('') + 'data: [DONE]\n\n'
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' }
  })
}

function createSequencedFetch(responses, requests) {
  let index = 0
  return async (_input, init) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')))
    const response = responses[index]
    index += 1
    if (!response) throw new Error(`缺少第 ${index} 个协议响应 fixture`)
    return response
  }
}

function createReadTool(executions) {
  return tool({
    description: '读取项目数据',
    inputSchema: z.object({
      entity_type: z.string(),
      summary_only: z.boolean().optional()
    }),
    execute: async (input) => {
      executions.push(input)
      return '陈朔：冷静、谨慎。'
    }
  })
}

test('OpenAI Compatible Chat 由 SDK 完成 reasoning、工具调用与结果回传', async () => {
  const requests = []
  const executions = []
  const requestFetch = createSequencedFetch([
    sseResponse([
      {
        id: 'chat-1',
        model: 'deepseek-v4-flash-free',
        choices: [{ index: 0, delta: { reasoning_content: '先读取人物卡。' }, finish_reason: null }]
      },
      {
        id: 'chat-1',
        model: 'deepseek-v4-flash-free',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call-character',
              type: 'function',
              function: {
                name: 'read_project_data',
                arguments: '{"entity_type":"character","summary_only":true}'
              }
            }]
          },
          finish_reason: null
        }]
      },
      {
        id: 'chat-1',
        model: 'deepseek-v4-flash-free',
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
      }
    ]),
    sseResponse([
      {
        id: 'chat-2',
        model: 'deepseek-v4-flash-free',
        choices: [{ index: 0, delta: { content: '陈朔的人物卡已读取。' }, finish_reason: null }]
      },
      {
        id: 'chat-2',
        model: 'deepseek-v4-flash-free',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 }
      }
    ])
  ], requests)

  const result = streamText({
    model: createProtocolModel({
      protocol: 'openai-chat',
      providerName: 'opencode-zen',
      model: 'deepseek-v4-flash-free',
      apiKey: 'test-key',
      baseUrl: 'https://opencode.test/zen/v1',
      fetch: requestFetch
    }),
    prompt: '读取陈朔的人物卡',
    tools: { read_project_data: createReadTool(executions) },
    stopWhen: stepCountIs(4)
  })

  const reasoning = []
  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'reasoning-delta') reasoning.push(part.text)
    if (part.type === 'text-delta') text += part.text
    if (part.type === 'error') throw part.error
  }

  assert.equal(reasoning.join(''), '先读取人物卡。')
  assert.equal(text, '陈朔的人物卡已读取。')
  assert.deepEqual(executions, [{ entity_type: 'character', summary_only: true }])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].tools[0].function.name, 'read_project_data')
  assert.equal(requests[1].messages.at(-1).role, 'tool')
  assert.match(requests[1].messages.at(-1).content, /陈朔/)
})

test('Anthropic Messages 由 SDK 完成工具调用与结果回传', async () => {
  const requests = []
  const executions = []
  const requestFetch = createSequencedFetch([
    sseResponse([
      {
        type: 'message_start',
        message: {
          id: 'msg-1',
          model: 'claude-sonnet-4-6',
          role: 'assistant',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 1 }
        }
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu-character',
          name: 'read_project_data',
          input: {}
        }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"entity_type":"character","summary_only":true}'
        }
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 8 }
      },
      { type: 'message_stop' }
    ]),
    sseResponse([
      {
        type: 'message_start',
        message: {
          id: 'msg-2',
          model: 'claude-sonnet-4-6',
          role: 'assistant',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 20, output_tokens: 1 }
        }
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '陈朔的人物卡已读取。' }
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 6 }
      },
      { type: 'message_stop' }
    ])
  ], requests)

  const result = streamText({
    model: createProtocolModel({
      protocol: 'anthropic',
      providerName: 'opencode-zen',
      model: 'claude-sonnet-4-6',
      apiKey: 'test-key',
      baseUrl: 'https://opencode.test/zen/v1',
      fetch: requestFetch
    }),
    prompt: '读取陈朔的人物卡',
    tools: { read_project_data: createReadTool(executions) },
    stopWhen: stepCountIs(4)
  })

  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') text += part.text
    if (part.type === 'error') throw part.error
  }

  assert.equal(text, '陈朔的人物卡已读取。')
  assert.deepEqual(executions, [{ entity_type: 'character', summary_only: true }])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].tools[0].name, 'read_project_data')
  assert.equal(requests[1].messages.at(-1).role, 'user')
  assert.equal(requests[1].messages.at(-1).content[0].type, 'tool_result')
  assert.match(requests[1].messages.at(-1).content[0].content, /陈朔/)
})

test('OpenAI Responses 由 SDK 完成工具调用与结果回传', async () => {
  const requests = []
  const executions = []
  const completed = (inputTokens, outputTokens) => ({
    type: 'response.completed',
    response: {
      incomplete_details: null,
      usage: {
        input_tokens: inputTokens,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: outputTokens,
        output_tokens_details: { reasoning_tokens: 0 }
      },
      service_tier: null
    }
  })
  const requestFetch = createSequencedFetch([
    sseResponse([
      {
        type: 'response.created',
        response: { id: 'resp-1', created_at: 1, model: 'gpt-5.6-sol', service_tier: null }
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc-1',
          call_id: 'call-character',
          name: 'read_project_data',
          arguments: ''
        }
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc-1',
        output_index: 0,
        delta: '{"entity_type":"character","summary_only":true}'
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc-1',
          call_id: 'call-character',
          name: 'read_project_data',
          arguments: '{"entity_type":"character","summary_only":true}',
          status: 'completed'
        }
      },
      completed(12, 8)
    ]),
    sseResponse([
      {
        type: 'response.created',
        response: { id: 'resp-2', created_at: 2, model: 'gpt-5.6-sol', service_tier: null }
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg-1', phase: 'final_answer' }
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg-1',
        delta: '陈朔的人物卡已读取。',
        logprobs: null
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'message', id: 'msg-1', phase: 'final_answer' }
      },
      completed(20, 6)
    ])
  ], requests)

  const result = streamText({
    model: createProtocolModel({
      protocol: 'openai-responses',
      providerName: 'opencode-zen',
      model: 'gpt-5.6-sol',
      apiKey: 'test-key',
      baseUrl: 'https://opencode.test/zen/v1',
      fetch: requestFetch
    }),
    prompt: '读取陈朔的人物卡',
    tools: { read_project_data: createReadTool(executions) },
    stopWhen: stepCountIs(4)
  })

  let text = ''
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') text += part.text
    if (part.type === 'error') throw part.error
  }

  assert.equal(text, '陈朔的人物卡已读取。')
  assert.deepEqual(executions, [{ entity_type: 'character', summary_only: true }])
  assert.equal(requests.length, 2)
  assert.equal(requests[0].tools[0].name, 'read_project_data')
  assert.equal(requests[1].input.at(-1).type, 'function_call_output')
  assert.match(requests[1].input.at(-1).output, /陈朔/)
})
