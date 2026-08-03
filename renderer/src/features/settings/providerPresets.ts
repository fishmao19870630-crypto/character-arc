import type { AppSettings } from '@/types/app'
import { AI_PROVIDER_CATALOG, type AiProviderCatalogEntry } from '@shared/ai-provider-catalog'

export type ProviderPreset = AiProviderCatalogEntry

export const providerPresets: readonly ProviderPreset[] = AI_PROVIDER_CATALOG

export const providerOptions = providerPresets.map(({ label, value }) => ({ label, value }))

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
