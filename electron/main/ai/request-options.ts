import type { AppSettings } from './shared-types'

export type AiProviderOptions = {
  openai?: {
    reasoningEffort: 'none'
  }
  openaiCompatible?: {
    reasoningEffort: 'low'
  }
}

export function isOpenAIReasoningChatModel(settings: AppSettings): boolean {
  const model = settings.model?.trim().toLowerCase() || ''
  return /^(gpt-5|o1|o3|o4-mini)/.test(model)
}

export function resolveProviderOptions(
  settings: AppSettings,
  options?: { disableReasoning?: boolean; preferLowReasoning?: boolean }
): AiProviderOptions | undefined {
  if (
    options?.preferLowReasoning
    && isOpenCodeReasoningChatModel(settings)
  ) {
    return {
      openaiCompatible: {
        reasoningEffort: 'low'
      }
    }
  }

  if (
    !options?.disableReasoning
    || settings.provider !== 'openai'
    || !isOpenAIReasoningChatModel(settings)
  ) {
    return undefined
  }

  return {
    openai: {
      reasoningEffort: 'none'
    }
  }
}

export function isOpenCodeReasoningChatModel(settings: AppSettings): boolean {
  const provider = settings.provider.trim().toLowerCase()
  if (provider !== 'opencode-zen' && provider !== 'opencode-go') {
    return false
  }

  const model = settings.model?.trim().toLowerCase() || ''
  if (/^(claude-|qwen3(?:[.-]|$)|gpt-|grok-)/.test(model)) return false
  return /^(deepseek-v4|minimax-|mimo-|glm-|kimi-|nemotron-)/.test(model)
}
