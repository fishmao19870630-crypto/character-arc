import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getAiProviderCatalogEntry,
  normalizeAiBaseUrl,
  normalizeAiProviderName,
  resolveAiProviderProtocol,
  shouldBufferOpenCodeChat
} from '../../shared/ai-provider-catalog.ts'

test('厂商预设会补齐默认地址和推荐模型', () => {
  const preset = getAiProviderCatalogEntry('deepseek')

  assert.equal(preset?.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(preset?.model, 'deepseek-chat')
  assert.equal(preset?.supportsEmbedding, false)
})

test('自定义接口保留明确填写的路径前缀', () => {
  assert.equal(
    normalizeAiBaseUrl('anthropic-compatible', 'https://relay.example.com/anthropic'),
    'https://relay.example.com/anthropic'
  )
})

test('旧版 OpenCode Zen 配置自动迁移为 Zen 厂商和规范地址', () => {
  assert.equal(normalizeAiProviderName('openai-compatible', 'https://opencode.ai/zen'), 'opencode-zen')
  assert.equal(normalizeAiBaseUrl('opencode-zen', 'https://opencode.ai/zen'), 'https://opencode.ai/zen/v1')
})

test('OpenCode Zen 根据模型族选择协议', () => {
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'gpt-5.6-sol'), 'openai-responses')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'grok-4.5'), 'openai-responses')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'claude-sonnet-4-6'), 'anthropic')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'qwen3.7-plus'), 'anthropic')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'deepseek-v4-pro'), 'openai-chat')
  assert.equal(resolveAiProviderProtocol('opencode-zen', 'kimi-k2.6'), 'openai-chat')
})

test('仅 OpenCode Zen 的 Chat Completions 模型使用完整响应缓冲', () => {
  assert.equal(shouldBufferOpenCodeChat('opencode-zen', 'deepseek-v4-flash-free'), true)
  assert.equal(shouldBufferOpenCodeChat('opencode-zen', 'kimi-k2.6'), true)
  assert.equal(shouldBufferOpenCodeChat('opencode-zen', 'gpt-5.6-sol'), false)
  assert.equal(shouldBufferOpenCodeChat('opencode-zen', 'claude-sonnet-4-6'), false)
  assert.equal(shouldBufferOpenCodeChat('deepseek', 'deepseek-chat'), false)
})
