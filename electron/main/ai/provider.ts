import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { AppSettings } from './shared-types'
import { extractReasoningText } from './reasoning'
import { createProxyFetch } from './proxy-fetch'
import {
  fetchWithResponseStartTimeout,
  readStreamChunkWithIdleTimeout,
  splitCompleteSseEvents
} from './sse'

const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000
const DEFAULT_RESPONSE_START_TIMEOUT_MS = 30_000

function resolveStreamIdleTimeoutMs(settings: AppSettings): number {
  const configuredMs = (settings.aiTimeoutSeconds ?? 180) * 1000
  return Math.min(DEFAULT_STREAM_IDLE_TIMEOUT_MS, Math.max(30_000, configuredMs))
}

const ANTHROPIC_PROMPT_CACHE = {
  type: 'ephemeral' as const,
  ttl: '5m' as const
}

function isOfficialOpenAIProvider(settings: AppSettings): boolean {
  return settings.provider === 'openai'
}

function shouldUseOpenAIResponses(settings: AppSettings): boolean {
  // A model name alone does not tell us whether an OpenAI-compatible relay
  // implements the Responses API. Most relays expose Chat Completions only;
  // routing long streaming requests through Responses can leave the SDK
  // waiting forever even though the relay has already produced a response.
  // Use Responses only when the user explicitly selected the official OpenAI
  // provider, and keep compatible endpoints on the broadly supported chat API.
  return isOfficialOpenAIProvider(settings)
}

export function providerSupportsNativeStructuredOutput(settings: AppSettings): boolean {
  // Anthropic's SDK object streaming can produce an empty text stream or fail
  // object parsing for otherwise recoverable JSON tasks. Keep Claude JSON tasks
  // on the text path and let task normalizers/repair prompts handle the JSON.
  if (settings.provider === 'anthropic') return false
  return isOfficialOpenAIProvider(settings)
}

function isOllamaProvider(settings: AppSettings): boolean {
  return settings.provider === 'ollama'
}

/**
 * 推理模型（mimo、deepseek-r1、智谱 GLM-Z1、Kimi-thinking 等）在 OpenAI 兼容协议中
 * 通过非标准字段 `delta.reasoning_content` 返回思考内容。AI SDK 的官方 OpenAI provider
 * 不解析这个字段，导致流式响应在思考阶段完全没有 text-delta 输出，UI 长时间无响应。
 *
 * 这里包装一层 fetch：拦截 SSE 流，把 reasoning_content 解析出来转发给回调，
 * 同时从 chunk 中移除该字段（避免后续解析时有歧义），让正文 content 保持原状。
 */
export function createReasoningInterceptedFetch(
  onReasoningDelta?: (delta: string) => void,
  requestFetch: typeof fetch = globalThis.fetch,
  idleTimeoutMs = DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  responseStartTimeoutMs = DEFAULT_RESPONSE_START_TIMEOUT_MS
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetchWithResponseStartTimeout(
      requestFetch,
      input,
      init,
      responseStartTimeoutMs
    )
    if (!response.ok || !response.body) return response

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) return response

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await readStreamChunkWithIdleTimeout(reader, idleTimeoutMs)
          if (done) {
            if (buffer) {
              controller.enqueue(encoder.encode(buffer))
              buffer = ''
            }
            controller.close()
            return
          }
          buffer += decoder.decode(value, { stream: true })
          // SSE 既可能使用 LF，也可能使用 HTTP 常见的 CRLF；两者都要实时切分。
          // 只查找 `\n\n` 会让 CRLF 响应一直留在 buffer，直到上游结束才显示内容。
          const split = splitCompleteSseEvents(buffer)
          const events = split.events
          buffer = split.remainder

          let outChunk = ''
          for (const event of events) {
            const lines = event.split(/\r?\n/)
            const rebuilt: string[] = []
            for (const line of lines) {
              if (!line.startsWith('data:')) {
                rebuilt.push(line)
                continue
              }
              const dataStr = line.slice(5).trim()
              if (!dataStr || dataStr === '[DONE]') {
                rebuilt.push(line)
                continue
              }
              try {
                const parsed = JSON.parse(dataStr)
                const delta = parsed?.choices?.[0]?.delta
                const message = parsed?.choices?.[0]?.message
                const reasoningKeys = ['reasoning_content', 'reasoning', 'thinking', 'reasoning_details']
                const sources = [delta, message].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
                if (sources.length > 0 && onReasoningDelta) {
                  let extracted = ''
                  let touched = false
                  for (const source of sources) {
                    for (const key of reasoningKeys) {
                      if (source[key] !== undefined) {
                        extracted += extractReasoningText(source[key])
                        delete source[key]
                        touched = true
                      }
                    }
                  }
                  if (extracted) onReasoningDelta(extracted)
                  if (touched) {
                    rebuilt.push(`data: ${JSON.stringify(parsed)}`)
                    continue
                  }
                }
              } catch {
                // 解析失败，原样转发
              }
              rebuilt.push(line)
            }
            outChunk += rebuilt.join('\n')
          }
          if (outChunk) {
            controller.enqueue(encoder.encode(outChunk))
          }
        } catch (err) {
          reader.cancel(err).catch(() => {})
          controller.error(err)
        }
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {})
      }
    })

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
}

function createOpenAICompatibleProvider(settings: AppSettings, customFetch?: typeof fetch) {
  const apiKey = settings.apiKey.trim()

  return createOpenAI({
    apiKey: apiKey || undefined,
    baseURL: settings.baseUrl || undefined,
    name: isOllamaProvider(settings) ? 'ollama' : undefined,
    fetch: customFetch
  })
}

export function createModel(settings: AppSettings, onReasoningDelta?: (delta: string) => void): LanguageModel {
  const requestFetch = createProxyFetch(settings.proxyUrl)
  if (settings.provider === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl || undefined,
      fetch: requestFetch
    })
    return anthropic(settings.model)
  }

  const customFetch = createReasoningInterceptedFetch(
    onReasoningDelta,
    requestFetch,
    resolveStreamIdleTimeoutMs(settings),
    Math.min(DEFAULT_RESPONSE_START_TIMEOUT_MS, resolveStreamIdleTimeoutMs(settings))
  )
  const openai = createOpenAICompatibleProvider(settings, customFetch)
  if (shouldUseOpenAIResponses(settings)) {
    return openai(settings.model)
  }

  return openai.chat(settings.model)
}

export function buildSystemPrompt(settings: AppSettings, systemPrompt: string) {
  if (settings.provider !== 'anthropic') {
    return systemPrompt
  }

  return {
    role: 'system' as const,
    content: systemPrompt,
    providerOptions: {
      anthropic: {
        cacheControl: ANTHROPIC_PROMPT_CACHE
      }
    }
  }
}

export function isToolUseNotSupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  const patterns = [
    'tools are not supported',
    'tool use is not supported',
    'does not support tools',
    'does not support function',
    'function calling is not supported',
    'tool_use is not supported',
    'tooluse is not supported',
    'unrecognized request argument.*tools',
    'invalid parameter.*tools',
    '不支持.*工具',
    '不支持.*tool'
  ]
  return patterns.some((p) => new RegExp(p, 'i').test(msg))
}
