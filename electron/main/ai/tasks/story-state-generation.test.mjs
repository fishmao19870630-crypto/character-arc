import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const taskContextSource = readFileSync(new URL('../runtime/task-context.ts', import.meta.url), 'utf8')
const orchestratorSource = readFileSync(new URL('../runtime/orchestrator.ts', import.meta.url), 'utf8')
const projectIdContextFiles = [
  '../../../../renderer/src/composables/useCatalogBatch.ts',
  '../../../../renderer/src/components/CharactersPanel.vue',
  '../../../../renderer/src/components/WorldviewPanel.vue',
  '../../../../renderer/src/components/OutlinePanel.vue'
]

const promptFiles = [
  'outline-item.ts',
  'outline-batch.ts',
  'outline-chain.ts',
  'outline-enhance.ts',
  'character-card.ts',
  'character-enhance.ts',
  'worldview-entry.ts',
  'worldview-enhance.ts',
  'catalog-batch.ts'
]

test('大纲、角色和世界观任务都会注入世界状态', () => {
  for (const task of [
    'outline-item',
    'outline-batch',
    'outline-chain',
    'outline-enhance',
    'character-card',
    'character-enhance',
    'worldview-entry',
    'worldview-enhance',
    'catalog-batch'
  ]) {
    assert.match(taskContextSource, new RegExp(`'${task}'`), `${task} 未加入世界状态注入范围`)
  }
})

test('相关生成提示词会实际消费世界状态', () => {
  for (const fileName of promptFiles) {
    const source = readFileSync(new URL(fileName, import.meta.url), 'utf8')
    assert.match(source, /formatStoryStateConstraint\(context\)/, `${fileName} 未使用世界状态提示块`)
  }
})

test('世界状态在 Agent 路由前完成注入', () => {
  const enrichIndex = orchestratorSource.indexOf('await enrichTaskContextForGeneration(task, settingsForRouting)')
  const agentRunIndex = orchestratorSource.indexOf('return await runAgentTask(task, knowledgeContext)')

  assert.ok(enrichIndex >= 0)
  assert.ok(agentRunIndex >= 0)
  assert.ok(enrichIndex < agentRunIndex)
})

test('相关界面请求会携带当前项目 ID', () => {
  for (const relativePath of projectIdContextFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    assert.match(source, /projectId: appStore\.currentProject\?\.id/)
  }
})
