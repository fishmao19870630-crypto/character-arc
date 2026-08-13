import type { AppSettings } from '@/types/app'
import { AI_PROVIDER_CATALOG, type AiProviderCatalogEntry } from '@shared/ai-provider-catalog'

export type ProviderPreset = AiProviderCatalogEntry

export const providerPresets: readonly ProviderPreset[] = AI_PROVIDER_CATALOG

const CUSTOM_PROVIDER_VALUES = new Set(['openai-compatible', 'anthropic-compatible'])

// 自定义接口是最通用的入口，置顶；其余预设保持目录中的稳定顺序。
export const providerOptions = [
  ...providerPresets.filter(({ value }) => CUSTOM_PROVIDER_VALUES.has(value)),
  ...providerPresets.filter(({ value }) => !CUSTOM_PROVIDER_VALUES.has(value))
].map(({ label, value }) => ({ label, value }))

export function getProviderPreset(provider: string): ProviderPreset {
  return providerPresets.find((item) => item.value === provider)
    ?? providerPresets.find((item) => item.value === 'openai-compatible')!
}

export function resolveProviderDefaults(provider: string): Pick<AppSettings, 'model' | 'baseUrl'> {
  const preset = getProviderPreset(provider)
  return {
    model: preset.model,
    baseUrl: preset.baseUrl
  }
}
