<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, ExternalLink, FileText, RefreshCw, Video } from 'lucide-vue-next'
import { NButton, NModal, NResult, NSpin, NTag } from 'naive-ui'
import {
  LOCAL_TUTORIAL,
  resolveFreshTutorial,
  type TutorialDocument,
  type TutorialResource,
  type TutorialResourceType
} from '@/features/tutorials/tutorials'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
}>()

const tutorial = ref<TutorialDocument>(LOCAL_TUTORIAL)
const loading = ref(false)
const fetchIssue = ref<'none' | 'failed' | 'stale'>('none')
const source = ref<'local' | 'remote'>('local')

const activeResources = computed(() => tutorial.value.resources.filter((resource) => resource.enabled || !resource.url))
const updatedLabel = computed(() => tutorial.value.updatedAt ? `内容更新于 ${tutorial.value.updatedAt}` : '本地教程')

const typeLabels: Record<TutorialResourceType, string> = {
  feishu: '飞书图文',
  bilibili: 'B站视频',
  github: 'GitHub 文档',
  external: '外部链接'
}

function resourceIcon(type: TutorialResourceType) {
  if (type === 'bilibili') return Video
  if (type === 'github') return FileText
  if (type === 'external') return ExternalLink
  return BookOpen
}

function openResource(resource: TutorialResource): void {
  if (!resource.url || !/^https?:\/\//i.test(resource.url)) return
  window.characterArc.openExternalUrl(resource.url)
}

async function fetchRemote(): Promise<void> {
  loading.value = true
  fetchIssue.value = 'none'
  try {
    const result = await window.characterArc.fetchTutorial()
    if (!result.success) {
      fetchIssue.value = 'failed'
      tutorial.value = LOCAL_TUTORIAL
      source.value = 'local'
      return
    }
    const resolution = resolveFreshTutorial(result.data, LOCAL_TUTORIAL)
    tutorial.value = resolution.document
    source.value = resolution.stale ? 'local' : 'remote'
    fetchIssue.value = resolution.stale ? 'stale' : 'none'
  } catch {
    fetchIssue.value = 'failed'
    tutorial.value = LOCAL_TUTORIAL
    source.value = 'local'
  } finally {
    loading.value = false
  }
}

function handleAfterEnter(): void {
  fetchRemote()
}
</script>

<template>
  <n-modal
    :show="props.show"
    preset="card"
    class="arc-editor-modal tutorial-modal"
    :bordered="false"
    @close="emit('update:show', false)"
    @after-enter="handleAfterEnter"
  >
    <template #header>
      <div class="tutorial-header">
        <span class="tutorial-header-icon"><BookOpen :size="19" /></span>
        <div>
          <div class="tutorial-title">{{ tutorial.title }}</div>
          <div class="tutorial-meta">{{ updatedLabel }}</div>
        </div>
      </div>
    </template>

    <div class="tutorial-body">
      <div class="tutorial-intro">
        <div class="tutorial-intro-kicker">快速上手</div>
        <p>{{ tutorial.intro }}</p>
      </div>

      <div v-if="fetchIssue !== 'none'" class="tutorial-notice">
        {{ fetchIssue === 'stale' ? '远程教程版本较旧，当前显示本地教程。' : '教程同步失败，当前显示本地教程。' }}
        <n-button text size="small" :loading="loading" @click="fetchRemote">
          <template #icon><RefreshCw :size="14" /></template>
          重试
        </n-button>
      </div>

      <div class="tutorial-source-row">
        <span>{{ source === 'remote' ? '远程内容' : '本地内容' }}</span>
        <n-spin v-if="loading" :size="14" />
      </div>

      <div v-if="activeResources.length" class="tutorial-resources">
        <article v-for="resource in activeResources" :key="resource.id" class="tutorial-resource">
          <div class="tutorial-resource-icon"><component :is="resourceIcon(resource.type)" :size="20" /></div>
          <div class="tutorial-resource-copy">
            <div class="tutorial-resource-topline">
              <h3>{{ resource.title }}</h3>
              <n-tag size="small" :bordered="false">{{ typeLabels[resource.type] }}</n-tag>
            </div>
            <p>{{ resource.description }}</p>
          </div>
          <n-button
            v-if="resource.url && resource.enabled"
            secondary
            size="small"
            @click="openResource(resource)"
          >
            <template #icon><ExternalLink :size="14" /></template>
            打开
          </n-button>
          <n-tag v-else size="small" type="warning" :bordered="false">即将发布</n-tag>
        </article>
      </div>
      <n-result v-else status="info" title="暂无教程资源" description="教程内容稍后会在远程配置中发布。" />
    </div>

    <template #footer>
      <div class="arc-modal-actions">
        <n-button round strong @click="emit('update:show', false)">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.tutorial-modal :deep(.n-card-header) {
  padding-bottom: 12px;
}

.tutorial-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tutorial-header-icon,
.tutorial-resource-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--arc-primary);
  background: var(--arc-primary-soft);
}

.tutorial-header-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
}

.tutorial-title {
  color: var(--arc-text-primary);
  font-size: 16px;
  font-weight: 720;
}

.tutorial-meta {
  margin-top: 3px;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 500;
}

.tutorial-body {
  max-height: min(64vh, 520px);
  overflow-y: auto;
  padding-right: 3px;
}

.tutorial-intro {
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--arc-primary) 18%, var(--arc-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--arc-primary-soft) 42%, var(--arc-bg-surface));
}

.tutorial-intro-kicker {
  color: var(--arc-primary);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.04em;
}

.tutorial-intro p {
  margin: 6px 0 0;
  color: var(--arc-text-secondary);
  font-size: 13px;
  line-height: 1.7;
}

.tutorial-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--arc-warning, #f59e0b) 30%, var(--arc-border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--arc-warning, #f59e0b) 8%, var(--arc-bg-surface));
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.tutorial-source-row {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 18px 0 8px;
  color: var(--arc-text-hint);
  font-size: 12px;
  font-weight: 600;
}

.tutorial-resources {
  display: grid;
  gap: 10px;
}

.tutorial-resource {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid var(--arc-border);
  border-radius: 10px;
  background: var(--arc-bg-surface);
  transition: border-color 0.2s, background 0.2s, transform 0.2s;
}

.tutorial-resource:hover {
  border-color: var(--arc-border-strong);
  background: var(--arc-bg-weak);
  transform: translateY(-1px);
}

.tutorial-resource-icon {
  width: 38px;
  height: 38px;
  border-radius: 9px;
}

.tutorial-resource-copy {
  min-width: 0;
  flex: 1;
}

.tutorial-resource-topline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tutorial-resource h3 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--arc-text-primary);
  font-size: 14px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tutorial-resource p {
  margin: 5px 0 0;
  color: var(--arc-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 560px) {
  .tutorial-resource {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .tutorial-resource-copy {
    flex-basis: calc(100% - 52px);
  }

  .tutorial-resource > :last-child {
    margin-left: 50px;
  }
}
</style>
