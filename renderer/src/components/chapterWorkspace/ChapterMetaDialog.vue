<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { NButton, NForm, NFormItem, NInput, NModal, NProgress, NSelect, useMessage } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import { DEFAULT_CHAPTER_WORD_TARGET, normalizeChapterWordTarget } from '@/features/chapters/wordTarget'
import { formatVolumeLabel } from '@/features/workspace/outlineVolumes'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { useAppStore } from '@/stores/app'
import type { ChapterDraft } from '@/types/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const props = defineProps<{
  show: boolean
  chapter: ChapterDraft | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const appStore = useAppStore()
const message = useMessage()
const isSubmitting = ref(false)
const activeSyncProjectId = ref('')
const activeSyncTaskId = ref('')
const syncModalVisible = ref(false)
const syncStatus = ref<'starting' | 'running' | 'success' | 'error'>('starting')
const syncProgressPercent = ref(0)
const syncProgressText = ref('')
const syncChapterTitle = ref('')
const syncError = ref('')
let syncCloseTimer: number | null = null

const form = reactive({
  outlineItemId: '',
  volumeId: '',
  title: '',
  summary: '',
  status: 'draft' as ChapterDraft['status'],
  wordTarget: ''
})

const statusOptions: SelectOption[] = [
  { label: '草稿中', value: 'draft' },
  { label: '待检查', value: 'review' },
  { label: '待润色', value: 'polish' },
  { label: '已定稿', value: 'final' }
]

const volumeOptions = computed<SelectOption[]>(() =>
  appStore.outlineVolumes.map((volume, index) => ({
    label: formatVolumeLabel(volume, index, 'formal'),
    value: volume.id
  }))
)

const outlineBindingOptions = computed<SelectOption[]>(() => {
  const currentChapterId = props.chapter?.id
  const targetVolumeId = form.volumeId || props.chapter?.volumeId || ''
  const items = appStore.outlineItems.filter((item) => !targetVolumeId || item.volumeId === targetVolumeId)
  return [
    { label: '不绑定大纲节点', value: '' },
    ...items.map((item) => {
      const linkedCount = appStore.chapters.filter((c) => c.outlineItemId === item.id && c.id !== currentChapterId).length
      return {
        label: linkedCount > 0 ? `${item.title} · 已关联 ${linkedCount} 章，可继续绑定` : item.title,
        value: item.id
      }
    })
  ]
})

watch(
  () => [props.show, props.chapter?.id] as const,
  ([show]) => {
    if (!show || !props.chapter) return
    form.volumeId = props.chapter.volumeId
    form.outlineItemId = props.chapter.outlineItemId
    form.title = props.chapter.title
    form.summary = props.chapter.summary
    form.status = props.chapter.status
    form.wordTarget = normalizeChapterWordTarget(props.chapter.wordTarget)
  },
  { immediate: true }
)

function handleWordTargetInput(value: string): void {
  form.wordTarget = value.replace(/\D/g, '').slice(0, 6)
}

function close(): void {
  if (isSubmitting.value) return
  emit('update:show', false)
}

function handleShowUpdate(value: boolean): void {
  if (!isSubmitting.value) emit('update:show', value)
}

const cleanupBackfillProgress = window.characterArc.onBackfillStateProgress((payload) => {
  if (
    payload.projectId !== activeSyncProjectId.value
    || (activeSyncTaskId.value && payload.taskId !== activeSyncTaskId.value)
  ) return

  syncChapterTitle.value = payload.chapterTitle || syncChapterTitle.value
  if (payload.status === 'running' || payload.status === 'pausing' || payload.status === 'paused') {
    syncStatus.value = 'running'
    const phaseRatio = payload.phase === 'applying' ? 0.85 : payload.phase === 'extracting' ? 0.35 : 0.1
    syncProgressPercent.value = payload.total > 0
      ? Math.min(95, Math.max(12, Math.round(8 + ((Math.max(0, payload.current - 1) + phaseRatio) / payload.total) * 87)))
      : 12
    syncProgressText.value = payload.message || '正在分析定稿正文并提取世界状态...'
    return
  }

  if (payload.status !== 'completed' && payload.status !== 'failed') return

  activeSyncProjectId.value = ''
  activeSyncTaskId.value = ''
  if (payload.status === 'failed') {
    syncStatus.value = 'error'
    syncError.value = payload.error ?? '未知错误'
    syncProgressText.value = '世界状态同步失败'
    return
  }
  if (payload.result?.failed) {
    const detail = payload.result.errors[0]?.message
    syncStatus.value = 'error'
    syncError.value = detail || '章节状态提取失败'
    syncProgressText.value = '世界状态同步未完成'
    return
  }
  syncStatus.value = 'success'
  syncProgressPercent.value = 100
  if (!payload.result?.totalChapters) {
    syncProgressText.value = '世界状态已是最新，无需重复同步'
    message.info('世界状态已是最新，无需重复同步。')
  } else {
    syncProgressText.value = '世界状态同步完成'
    message.success('世界状态同步完成。')
  }
  syncCloseTimer = window.setTimeout(() => {
    syncModalVisible.value = false
    syncCloseTimer = null
  }, 700)
})

onBeforeUnmount(() => {
  cleanupBackfillProgress()
  if (syncCloseTimer !== null) window.clearTimeout(syncCloseTimer)
})

async function startFinalStateSync(projectId: string, chapterId: string): Promise<void> {
  activeSyncProjectId.value = projectId
  activeSyncTaskId.value = ''
  syncModalVisible.value = true
  syncStatus.value = 'starting'
  syncProgressPercent.value = 6
  syncProgressText.value = '正在启动世界状态同步...'
  syncChapterTitle.value = appStore.chapters.find((item) => item.id === chapterId)?.title ?? ''
  syncError.value = ''
  try {
    const response = await window.characterArc.backfillProjectState(toIpcPayload({
      settings: appStore.appSettings,
      projectId,
      selection: { mode: 'custom', chapterIds: [chapterId] }
    }))
    if (!response.success || !response.result?.taskId) {
      throw new Error(response.error ?? '未能创建后台同步任务')
    }
    if (activeSyncProjectId.value !== projectId) return
    activeSyncTaskId.value = response.result.taskId
    syncStatus.value = 'running'
    syncProgressPercent.value = Math.max(syncProgressPercent.value, 12)
    syncProgressText.value = '正在分析定稿正文并提取世界状态...'
  } catch (error) {
    activeSyncProjectId.value = ''
    activeSyncTaskId.value = ''
    syncStatus.value = 'error'
    syncError.value = error instanceof Error ? error.message : '未知错误'
    syncProgressText.value = '世界状态同步启动失败'
  }
}

function closeSyncModal(): void {
  if (syncStatus.value === 'starting' || syncStatus.value === 'running') return
  syncModalVisible.value = false
}

async function submit(): Promise<void> {
  if (!props.chapter || isSubmitting.value) return
  if (!form.volumeId) {
    message.warning('请选择所属分卷')
    return
  }
  if (!form.title.trim()) {
    message.warning('请填写章节标题')
    return
  }
  if (!form.wordTarget.trim()) {
    form.wordTarget = DEFAULT_CHAPTER_WORD_TARGET
  }
  isSubmitting.value = true
  try {
    const chapterId = props.chapter.id
    appStore.updateChapter(chapterId, {
      outlineItemId: form.outlineItemId,
      volumeId: form.volumeId,
      title: form.title,
      summary: form.summary,
      status: form.status,
      wordTarget: normalizeChapterWordTarget(form.wordTarget)
    })

    await appStore.persistWorkspace()
    if (appStore.persistenceError) {
      message.error(`章节信息保存失败：${appStore.persistenceError}`)
      return
    }

    const shouldSyncState = form.status === 'final'
    const projectId = appStore.currentProject?.id ?? ''
    const chapter = appStore.chapters.find((item) => item.id === chapterId)
    const chapterText = getPlainTextFromEditorContent(chapter?.content ?? '').trim()

    emit('update:show', false)
    message.success(shouldSyncState ? '章节已定稿，正文和章节信息已保存。' : '章节信息已保存。')

    if (!shouldSyncState) return
    if (!projectId || chapterText.length < 50) {
      message.warning('正文内容过短，暂未生成世界状态。')
      return
    }
    void startFinalStateSync(projectId, chapterId)
  } catch (error) {
    message.error(`章节信息保存失败：${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="编辑章节信息"
    :style="{ width: 'min(560px, 92vw)' }"
    :bordered="false"
    :closable="!isSubmitting"
    :mask-closable="!isSubmitting"
    @update:show="handleShowUpdate"
  >
    <n-form label-placement="top">
      <n-form-item label="所属分卷">
        <n-select v-model:value="form.volumeId" :options="volumeOptions" placeholder="选择这一章所在的分卷" />
      </n-form-item>
      <n-form-item label="绑定大纲节点">
        <n-select
          v-model:value="form.outlineItemId"
          :options="outlineBindingOptions"
          placeholder="可手动绑定或解绑当前章节对应的大纲节点"
        />
      </n-form-item>
      <n-form-item label="章节标题">
        <n-input v-model:value="form.title" placeholder="例如：第4章：夜城回响" />
      </n-form-item>
      <n-form-item label="章节摘要">
        <n-input
          v-model:value="form.summary"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 5 }"
          placeholder="用 1 到 2 句话概括这一章的核心事件和推进点..."
        />
      </n-form-item>
      <n-form-item label="章节状态">
        <n-select v-model:value="form.status" :options="statusOptions" />
      </n-form-item>
      <n-form-item label="预估字数">
        <n-input
          :value="form.wordTarget"
          inputmode="numeric"
          placeholder="例如：3000"
          @update:value="handleWordTargetInput"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="actions">
        <n-button round strong :disabled="isSubmitting" @click="close">取消</n-button>
        <n-button type="primary" round strong :loading="isSubmitting" @click="submit">保存修改</n-button>
      </div>
    </template>
  </n-modal>

  <n-modal
    :show="syncModalVisible"
    preset="card"
    title="同步世界状态"
    :style="{ width: 'min(480px, 92vw)' }"
    :bordered="false"
    :closable="syncStatus === 'error'"
    :mask-closable="false"
    @update:show="(value) => { if (!value) closeSyncModal() }"
  >
    <div class="sync-progress" role="status" aria-live="polite">
      <n-progress
        type="line"
        :percentage="syncProgressPercent"
        :processing="syncStatus === 'starting' || syncStatus === 'running'"
        :status="syncStatus === 'error' ? 'error' : syncStatus === 'success' ? 'success' : 'default'"
      />
      <strong>{{ syncProgressText }}</strong>
      <span v-if="syncChapterTitle" class="sync-chapter">当前章节：{{ syncChapterTitle }}</span>
      <p v-if="syncError" class="sync-error">
        {{ syncError }}。请重新保存定稿，或稍后在项目知识库中执行状态补录。
      </p>
    </div>

    <template v-if="syncStatus === 'error'" #footer>
      <div class="actions">
        <n-button type="primary" @click="closeSyncModal">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.sync-progress {
  display: flex;
  min-height: 116px;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
}

.sync-progress strong {
  color: var(--arc-text-primary);
  font-size: 14px;
}

.sync-chapter {
  color: var(--arc-text-secondary);
  font-size: 12px;
}

.sync-error {
  margin: 0;
  color: var(--arc-error, #d03050);
  font-size: 12px;
  line-height: 1.6;
}
</style>
