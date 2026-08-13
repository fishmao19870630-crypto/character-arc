import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type AiWireProtocol = 'openai-responses' | 'openai-chat' | 'anthropic'

export interface ProtocolModelOptions {
  protocol: AiWireProtocol
  providerName: string
  model: string
  apiKey: string
  baseUrl?: string
  fetch: typeof globalThis.fetch
}

/**
 * 三种线协议到开源 AI SDK provider 的唯一映射入口。
 * 这里不做模型判断、SSE 解析或产品级降级。
 */
export function createProtocolModel(options: ProtocolModelOptions): LanguageModel {
  if (options.protocol === 'anthropic') {
    const anthropic = createAnthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl || undefined,
      fetch: options.fetch
    })
    return anthropic(options.model)
  }

  if (options.protocol === 'openai-responses') {
    const openai = createOpenAI({
      apiKey: options.apiKey || undefined,
      baseURL: options.baseUrl || undefined,
      fetch: options.fetch
    })
    return openai(options.model)
  }

  const compatible = createOpenAICompatible({
    name: options.providerName,
    apiKey: options.apiKey || undefined,
    baseURL: options.baseUrl || 'https://api.openai.com/v1',
    fetch: options.fetch
  })
  return compatible.chatModel(options.model)
}
