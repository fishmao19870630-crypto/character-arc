<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NInput,
  NProgress,
  NSelect,
  NSwitch,
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Combine,
  FileText,
  FolderOpen,
  ListTree,
  LoaderCircle,
  RotateCcw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Users
} from 'lucide-vue-next'

import { useAppStore } from '@/stores/app'
import { createDefaultWorkflowDocuments } from '@/features/novelWorkflow/documents'
import type { CharacterCard, ChapterDraft, OutlineItem, OutlineVolume } from '@/types/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import {
  buildContinuationChapterTitle,
  inferNextContinuationChapterTitle,
  plainNovelTextToHtml,
  type ContinuationImportChapter,
  type ContinuationNovelFilePreview
} from '@shared/continuation-import'

type Stage = 'source' | 'review' | 'setup' | 'analysis' | 'ai-review'

type ChapterAnalysis = {
  chapterId: string
  title: string
  summary: string
  characters: Array<{ name: string; role: string }>
  hooks: string[]
  volumeTitle?: string
}

type AggregateAnalysis = {
  bookSummary: string
  continuationStatus: string
  pendingHooks: string[]
  characters: Array<{
    name: string
    role: string
    description: string
    tags: string[]
  }>
  volumeSummaries: Array<{ title: string; summary: string }>
}

const appStore = useAppStore()
const dialog = useDialog()
const message = useMessage()
const stage = ref<Stage>('source')
const preview = ref<(ContinuationNovelFilePreview & { sourceHash: string }) | null>(null)
const chapters = ref<ContinuationImportChapter[]>([])
const selectedChapterId = ref('')
const chapterSearch = ref('')
const contentEditorRef = ref<HTMLTextAreaElement | null>(null)
const isPicking = ref(false)
const analysisProgress = ref(0)
const analysisMessage = ref('')
const analysisCanceled = ref(false)
const activeAiTaskId = ref('')
const chapterAnalyses = ref<ChapterAnalysis[]>([])
const aggregateAnalysis = ref<AggregateAnalysis | null>(null)
const includedCharacterNames = ref<string[]>([])

const projectForm = reactive({
  title: '',
  genre: '未分类',
  novelLength: 'long' as 'short' | 'long',
  targetPlatform: '',
  nextChapterTitle: '',
  useAi: false,
  aiSummaries: true,
  aiCharacters: true,
  aiOutline: true,
  analysisScope: 'quick' as 'quick' | 'balanced' | 'full'
})

const genreOptions = [
  '都市', '玄幻', '仙侠', '科幻', '悬疑', '历史', '现实', '言情', '青春', '游戏', '轻小说', '未分类'
].map((label) => ({ label, value: label }))
const platformOptions = ['番茄小说', '起点中文网', '晋江文学城', '七猫小说', '知乎盐选', '其他']
  .map((label) => ({ label, value: label }))
const scopeOptions = [
  { label: '快速整理（最近 20 章）', value: 'quick' },
  { label: '均衡整理（最近 50 章）', value: 'balanced' },
  { label: '完整整理（全部章节）', value: 'full' }
]

const stepItems = [
  { key: 'source', label: '选择文件' },
  { key: 'review', label: '校对章节' },
  { key: 'setup', label: '项目设置' },
  { key: 'ai-review', label: '确认创建' }
]

const stepIndex = computed(() => {
  if (stage.value === 'analysis') return 2
  return Math.max(0, stepItems.findIndex((item) => item.key === stage.value))
})
const selectedChapter = computed(() => chapters.value.find((chapter) => chapter.id === selectedChapterId.value) ?? null)
const selectedChapterIndex = computed(() => chapters.value.findIndex((chapter) => chapter.id === selectedChapterId.value))
const filteredChapters = computed(() => {
  const keyword = chapterSearch.value.trim().toLowerCase()
  if (!keyword) return chapters.value
  return chapters.value.filter((chapter) =>
    chapter.title.toLowerCase().includes(keyword) || chapter.volumeTitle.toLowerCase().includes(keyword)
  )
})
const totalCharacterCount = computed(() => chapters.value.reduce((sum, chapter) => sum + chapter.characterCount, 0))
const volumeCount = computed(() => new Set(chapters.value.map((chapter) => chapter.volumeTitle.trim() || '正文')).size)
const hasAiSettings = computed(() => Boolean(appStore.appSettings.model && appStore.appSettings.apiKey))
const hasAiModule = computed(() => projectForm.aiSummaries || projectForm.aiCharacters || projectForm.aiOutline)
const analysisChapterCount = computed(() => {
  if (projectForm.analysisScope === 'quick') return Math.min(20, chapters.value.length)
  if (projectForm.analysisScope === 'balanced') return Math.min(50, chapters.value.length)
  return chapters.value.length
})

let entityCounter = 0
function entityId(prefix: string): string {
  entityCounter += 1
  return `${prefix}-${Date.now()}-${entityCounter}`
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN')
}

function formatSize(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function cloneChapters(items: ContinuationImportChapter[]): ContinuationImportChapter[] {
  return items.map((chapter) => ({ ...chapter }))
}

async function pickNovel(): Promise<void> {
  isPicking.value = true
  try {
    const result = await window.characterArc.pickContinuationNovel()
    if (result.canceled) return
    if (!result.success || !result.preview) {
      throw new Error(result.error || '读取小说文件失败')
    }
    preview.value = result.preview
    chapters.value = cloneChapters(result.preview.chapters)
    selectedChapterId.value = chapters.value[0]?.id ?? ''
    projectForm.title = result.preview.title
    projectForm.novelLength = result.preview.characterCount >= 80_000 ? 'long' : 'short'
    projectForm.nextChapterTitle = inferNextContinuationChapterTitle(chapters.value)
    projectForm.analysisScope = 'quick'
    stage.value = 'review'
  } catch (error) {
    message.error(error instanceof Error ? error.message : '读取小说文件失败')
  } finally {
    isPicking.value = false
  }
}

function resetImport(): void {
  preview.value = null
  chapters.value = []
  selectedChapterId.value = ''
  chapterAnalyses.value = []
  aggregateAnalysis.value = null
  stage.value = 'source'
}

function selectChapter(chapterId: string): void {
  selectedChapterId.value = chapterId
}

function updateSelectedCharacterCount(): void {
  if (!selectedChapter.value) return
  selectedChapter.value.characterCount = selectedChapter.value.content.replace(/\s+/g, '').length
}

function moveSelectedChapter(direction: -1 | 1): void {
  const index = selectedChapterIndex.value
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= chapters.value.length) return
  const next = [...chapters.value]
  const [chapter] = next.splice(index, 1)
  next.splice(targetIndex, 0, chapter)
  chapters.value = next
}

function removeSelectedChapter(): void {
  const index = selectedChapterIndex.value
  if (index < 0) return
  const next = [...chapters.value]
  next.splice(index, 1)
  chapters.value = next
  selectedChapterId.value = next[Math.min(index, next.length - 1)]?.id ?? ''
  projectForm.nextChapterTitle = inferNextContinuationChapterTitle(next)
}

function mergeWithPrevious(): void {
  const index = selectedChapterIndex.value
  if (index <= 0) return
  const previous = chapters.value[index - 1]
  const current = chapters.value[index]
  previous.content = [previous.content, current.content].filter(Boolean).join('\n\n')
  previous.characterCount = previous.content.replace(/\s+/g, '').length
  chapters.value.splice(index, 1)
  selectedChapterId.value = previous.id
  projectForm.nextChapterTitle = inferNextContinuationChapterTitle(chapters.value)
}

function splitAtCursor(): void {
  const chapter = selectedChapter.value
  const cursor = contentEditorRef.value?.selectionStart ?? -1
  if (!chapter || cursor <= 0 || cursor >= chapter.content.length) {
    message.warning('请先把光标放在正文需要拆分的位置')
    return
  }
  const before = chapter.content.slice(0, cursor).trim()
  const after = chapter.content.slice(cursor).trim()
  if (!before || !after) {
    message.warning('拆分位置前后都需要有正文')
    return
  }
  chapter.content = before
  chapter.characterCount = before.replace(/\s+/g, '').length
  const nextChapter: ContinuationImportChapter = {
    id: entityId('import-chapter'),
    title: `${chapter.title}（下）`,
    volumeTitle: chapter.volumeTitle,
    content: after,
    characterCount: after.replace(/\s+/g, '').length,
    confidence: 'medium'
  }
  chapters.value.splice(selectedChapterIndex.value + 1, 0, nextChapter)
  selectedChapterId.value = nextChapter.id
  projectForm.nextChapterTitle = inferNextContinuationChapterTitle(chapters.value)
  void nextTick(() => contentEditorRef.value?.focus())
}

function proceedToSetup(): void {
  if (chapters.value.length === 0) {
    message.warning('至少保留一个章节才能创建续写项目')
    return
  }
  if (chapters.value.some((chapter) => !chapter.title.trim())) {
    message.warning('请补全所有章节标题')
    return
  }
  stage.value = 'setup'
}

function buildAnalysisBatches(source: ContinuationImportChapter[]): ContinuationImportChapter[][] {
  const batches: ContinuationImportChapter[][] = []
  let current: ContinuationImportChapter[] = []
  let currentLength = 0
  for (const chapter of source) {
    const clippedChapter = { ...chapter, content: chapter.content.slice(0, 12_000) }
    const nextLength = currentLength + clippedChapter.content.length
    if (current.length > 0 && (current.length >= 5 || nextLength > 32_000)) {
      batches.push(current)
      current = []
      currentLength = 0
    }
    current.push(clippedChapter)
    currentLength += clippedChapter.content.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

async function cancelAnalysis(): Promise<void> {
  analysisCanceled.value = true
  if (activeAiTaskId.value) {
    await window.characterArc.cancelAiTask(activeAiTaskId.value)
  }
}

function confirmAiAnalysis(): void {
  if (!hasAiSettings.value) {
    message.warning('请先在主页设置中配置可用的 AI 模型')
    return
  }
  if (!hasAiModule.value) {
    message.warning('请至少选择一个 AI 分析项')
    return
  }

  const scopeLabel = scopeOptions.find((option) => option.value === projectForm.analysisScope)?.label ?? 'AI 整理'
  dialog.warning({
    title: '确认开始 AI 分析',
    content: `本次将使用“${scopeLabel}”分析 ${analysisChapterCount.value} 章正文，会发起多次 AI 请求并消耗大量 Token。是否继续？`,
    positiveText: '继续分析',
    negativeText: '取消',
    onPositiveClick: () => {
      void runAiAnalysis()
    }
  })
}

async function runAiAnalysis(): Promise<void> {
  if (!hasAiSettings.value) {
    message.warning('请先在主页设置中配置可用的 AI 模型')
    return
  }
  if (!hasAiModule.value) {
    message.warning('请至少选择一个 AI 分析项')
    return
  }

  stage.value = 'analysis'
  analysisCanceled.value = false
  analysisProgress.value = 0
  chapterAnalyses.value = []
  aggregateAnalysis.value = null

  try {
    const sourceChapters = projectForm.analysisScope === 'full'
      ? chapters.value
      : chapters.value.slice(-analysisChapterCount.value)
    const batches = buildAnalysisBatches(sourceChapters)
    for (let index = 0; index < batches.length; index += 1) {
      if (analysisCanceled.value) throw new Error('AI 分析已取消')
      analysisMessage.value = `正在分析章节批次 ${index + 1}/${batches.length}`
      activeAiTaskId.value = entityId('continuation-analysis')
      const result = await window.characterArc.generateAi(toIpcPayload({
        task: 'continuation-import-chunk',
        settings: appStore.appSettings,
        clientTaskId: activeAiTaskId.value,
        context: {
          chapters: batches[index].map((chapter) => ({
            chapterId: chapter.id,
            title: chapter.title,
            volumeTitle: chapter.volumeTitle,
            content: chapter.content
          }))
        }
      }))
      if (!result.success || !result.result) {
        throw new Error(result.error || `章节批次 ${index + 1} 分析失败`)
      }
      const entries = (result.result as { entries?: ChapterAnalysis[] }).entries ?? []
      chapterAnalyses.value.push(...entries.map((entry) => ({
        ...entry,
        volumeTitle: chapters.value.find((chapter) => chapter.id === entry.chapterId)?.volumeTitle ?? '正文'
      })))
      analysisProgress.value = Math.round(((index + 1) / (batches.length + 1)) * 100)
    }

    analysisMessage.value = '正在聚合人物、大纲和续写状态'
    activeAiTaskId.value = entityId('continuation-aggregate')
    const aggregateResult = await window.characterArc.generateAi(toIpcPayload({
      task: 'continuation-import-aggregate',
      settings: appStore.appSettings,
      clientTaskId: activeAiTaskId.value,
      context: {
        projectTitle: projectForm.title,
        projectGenre: projectForm.genre,
        includeCharacters: projectForm.aiCharacters,
        includeOutline: projectForm.aiOutline,
        chapterAnalyses: chapterAnalyses.value
      }
    }))
    if (!aggregateResult.success || !aggregateResult.result) {
      throw new Error(aggregateResult.error || '全书分析聚合失败')
    }
    aggregateAnalysis.value = aggregateResult.result as AggregateAnalysis
    includedCharacterNames.value = aggregateAnalysis.value.characters.map((character) => character.name)
    analysisProgress.value = 100
    stage.value = 'ai-review'
  } catch (error) {
    if (analysisCanceled.value) {
      message.info('AI 分析已取消，仍可不使用 AI 创建项目')
    } else {
      message.error(error instanceof Error ? error.message : 'AI 分析失败')
    }
    stage.value = 'setup'
  } finally {
    activeAiTaskId.value = ''
  }
}

function toggleCharacter(name: string, checked: boolean): void {
  const names = new Set(includedCharacterNames.value)
  if (checked) names.add(name)
  else names.delete(name)
  includedCharacterNames.value = Array.from(names)
}

function buildWorkflowDocuments(): ReturnType<typeof createDefaultWorkflowDocuments> {
  const now = new Date().toISOString()
  const pendingHooks = aggregateAnalysis.value?.pendingHooks ?? []
  const status = aggregateAnalysis.value?.continuationStatus
    || `已导入 ${chapters.value.length} 章，续写从“${projectForm.nextChapterTitle}”开始。`
  const bookSummary = aggregateAnalysis.value?.bookSummary || '原文已导入，尚未生成全书摘要。'
  return createDefaultWorkflowDocuments().map((document) => {
    if (document.key === 'current_status') return { ...document, content: status, updatedAt: now }
    if (document.key === 'novel_setting') return { ...document, content: bookSummary, updatedAt: now }
    if (document.key === 'pending_hooks') {
      return {
        ...document,
        content: pendingHooks.length ? pendingHooks.map((hook) => `- ${hook}`).join('\n') : '暂无已确认的待回收伏笔。',
        updatedAt: now
      }
    }
    if (document.key === 'progress') {
      return { ...document, content: `已导入 ${chapters.value.length} 章，共 ${formatNumber(totalCharacterCount.value)} 字。`, updatedAt: now }
    }
    if (document.key === 'resource_ledger') {
      return {
        ...document,
        content: `来源文件：${preview.value?.fileName ?? ''}\n编码：${preview.value?.encoding ?? ''}\nSHA-256：${preview.value?.sourceHash ?? ''}`,
        updatedAt: now
      }
    }
    return document
  })
}

function createContinuationProject(): void {
  if (!projectForm.title.trim()) {
    message.warning('请填写作品名称')
    return
  }
  if (chapters.value.length === 0) {
    message.warning('没有可导入的章节')
    return
  }

  const volumeTitles = Array.from(new Set(chapters.value.map((chapter) => chapter.volumeTitle.trim() || '正文')))
  const volumeSummaryMap = new Map((aggregateAnalysis.value?.volumeSummaries ?? []).map((item) => [item.title, item.summary]))
  const volumeIdMap = new Map<string, string>()
  const workflowDocuments = buildWorkflowDocuments()
  const volumes: OutlineVolume[] = volumeTitles.map((title, index) => {
    const id = entityId('volume')
    volumeIdMap.set(title, id)
    return {
      id,
      title,
      wordTarget: String(chapters.value.filter((chapter) => (chapter.volumeTitle.trim() || '正文') === title)
        .reduce((sum, chapter) => sum + chapter.characterCount, 0)),
      summary: volumeSummaryMap.get(title) || '原文导入分卷，待补充分卷摘要。',
      workflowDocuments: index === 0 ? workflowDocuments : createDefaultWorkflowDocuments()
    }
  })

  const summaryMap = new Map(chapterAnalyses.value.map((item) => [item.chapterId, item.summary]))
  const outlineItems: OutlineItem[] = []
  const chapterDrafts: ChapterDraft[] = []
  chapters.value.forEach((chapter, index) => {
    const volumeId = volumeIdMap.get(chapter.volumeTitle.trim() || '正文') || volumes[0].id
    const outlineId = entityId('outline')
    const chapterId = entityId('chapter')
    const summary = projectForm.aiSummaries
      ? summaryMap.get(chapter.id) || 'AI 未覆盖本章，待补充章节摘要。'
      : '原文导入章节，待补充章节摘要。'
    outlineItems.push({
      id: outlineId,
      volumeId,
      title: chapter.title,
      wordTarget: String(Math.max(1, chapter.characterCount)),
      conflict: '原文既有剧情',
      summary,
      status: 'done',
      sortOrder: index
    })
    chapterDrafts.push({
      id: chapterId,
      outlineItemId: outlineId,
      volumeId,
      title: chapter.title,
      summary,
      status: 'final',
      wordTarget: String(Math.max(1, chapter.characterCount)),
      content: plainNovelTextToHtml(chapter.content)
    })
  })

  const lastVolumeId = chapterDrafts[chapterDrafts.length - 1]?.volumeId || volumes[0].id
  const nextOutlineId = entityId('outline')
  const nextChapterId = entityId('chapter')
  outlineItems.push({
    id: nextOutlineId,
    volumeId: lastVolumeId,
    title: projectForm.nextChapterTitle.trim() || buildContinuationChapterTitle(chapters.value.length),
    wordTarget: '3000',
    conflict: '待规划续写冲突',
    summary: '待规划续写内容。',
    status: 'drafting',
    sortOrder: outlineItems.length
  })
  chapterDrafts.push({
    id: nextChapterId,
    outlineItemId: nextOutlineId,
    volumeId: lastVolumeId,
    title: projectForm.nextChapterTitle.trim() || buildContinuationChapterTitle(chapters.value.length),
    summary: '待规划续写内容。',
    status: 'draft',
    wordTarget: '3000',
    content: ''
  })

  const acceptedNames = new Set(includedCharacterNames.value)
  const characters: CharacterCard[] = projectForm.aiCharacters
    ? (aggregateAnalysis.value?.characters ?? [])
        .filter((character) => acceptedNames.has(character.name))
        .map((character) => ({
          id: entityId('character'),
          name: character.name,
          role: character.role || '待确认角色定位',
          description: character.description,
          avatar: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
          tags: character.tags.map((label) => ({ label, tone: 'default' as const }))
        }))
    : []

  appStore.createProjectWorkspace({
    project: {
      title: projectForm.title.trim(),
      genre: projectForm.genre,
      novelLength: projectForm.novelLength,
      targetPlatform: projectForm.targetPlatform
    },
    outlineVolumes: volumes,
    outlineItems,
    chapters: chapterDrafts,
    characters
  })
  appStore.openChapterStudio(nextChapterId)
  message.success(`已导入 ${chapters.value.length} 章，续写章节已创建`)
}
</script>

<template>
  <section class="continuation-page">
    <header class="continuation-header">
      <button class="back-button" type="button" title="返回主页" @click="appStore.backToProjects()">
        <ArrowLeft :size="18" />
      </button>
      <div class="header-copy">
        <h1>导入续写</h1>
        <p v-if="preview">{{ preview.fileName }} · {{ preview.encoding }}</p>
        <p v-else>从本地 TXT 创建可继续写作的小说项目</p>
      </div>
      <div v-if="preview" class="header-stats">
        <span><strong>{{ chapters.length }}</strong> 章</span>
        <span><strong>{{ volumeCount }}</strong> 卷</span>
        <span><strong>{{ formatNumber(totalCharacterCount) }}</strong> 字</span>
      </div>
    </header>

    <nav class="step-bar" aria-label="导入步骤">
      <div
        v-for="(item, index) in stepItems"
        :key="item.key"
        class="step-item"
        :class="{ active: index === stepIndex, done: index < stepIndex }"
      >
        <span class="step-index"><Check v-if="index < stepIndex" :size="13" /><template v-else>{{ index + 1 }}</template></span>
        <span>{{ item.label }}</span>
      </div>
    </nav>

    <main v-if="stage === 'source'" class="source-stage">
      <div class="source-mark"><BookOpen :size="30" /></div>
      <h2>选择需要继续创作的小说</h2>
      <p>支持 TXT 文件，文件内容会先在本地完成编码识别与章节拆分。</p>
      <n-button type="primary" size="large" :loading="isPicking" @click="pickNovel">
        <template #icon><FolderOpen :size="19" /></template>
        选择 TXT 文件
      </n-button>
    </main>

    <main v-else-if="stage === 'review'" class="review-stage">
      <aside class="chapter-rail">
        <div class="rail-head">
          <div>
            <strong>章节校对</strong>
            <span>{{ chapters.length }} 章</span>
          </div>
          <n-button quaternary circle size="small" title="重新选择文件" @click="resetImport">
            <template #icon><RotateCcw :size="15" /></template>
          </n-button>
        </div>
        <n-input v-model:value="chapterSearch" size="small" placeholder="搜索章节或分卷" clearable />
        <div class="chapter-list">
          <button
            v-for="chapter in filteredChapters"
            :key="chapter.id"
            class="chapter-row"
            :class="{ active: chapter.id === selectedChapterId }"
            type="button"
            @click="selectChapter(chapter.id)"
          >
            <span class="chapter-row-title">{{ chapter.title }}</span>
            <span class="chapter-row-meta">{{ chapter.volumeTitle }} · {{ formatNumber(chapter.characterCount) }}字</span>
          </button>
        </div>
      </aside>

      <section v-if="selectedChapter" class="chapter-editor">
        <div class="editor-toolbar">
          <div class="editor-fields">
            <n-input v-model:value="selectedChapter.title" placeholder="章节标题" />
            <n-input v-model:value="selectedChapter.volumeTitle" placeholder="所属分卷" />
          </div>
          <div class="editor-actions">
            <button type="button" title="上移章节" :disabled="selectedChapterIndex <= 0" @click="moveSelectedChapter(-1)"><ChevronUp :size="16" /></button>
            <button type="button" title="下移章节" :disabled="selectedChapterIndex >= chapters.length - 1" @click="moveSelectedChapter(1)"><ChevronDown :size="16" /></button>
            <button type="button" title="从光标处拆分" @click="splitAtCursor"><Scissors :size="16" /></button>
            <button type="button" title="合并到上一章" :disabled="selectedChapterIndex <= 0" @click="mergeWithPrevious"><Combine :size="16" /></button>
            <button class="danger" type="button" title="删除当前章节" @click="removeSelectedChapter"><Trash2 :size="16" /></button>
          </div>
        </div>
        <textarea
          ref="contentEditorRef"
          v-model="selectedChapter.content"
          class="content-editor"
          spellcheck="false"
          @input="updateSelectedCharacterCount"
        ></textarea>
        <footer class="editor-footer">
          <span>{{ formatNumber(selectedChapter.characterCount) }} 字</span>
          <n-tag v-if="selectedChapter.confidence !== 'high'" size="small" type="warning" :bordered="false">
            需要确认
          </n-tag>
        </footer>
      </section>

      <aside class="review-summary">
        <n-alert v-for="warning in preview?.warnings" :key="warning" type="warning" :show-icon="false">
          {{ warning }}
        </n-alert>
        <div class="summary-block">
          <span>源文件</span>
          <strong>{{ preview?.fileName }}</strong>
          <small>{{ formatSize(preview?.fileSize ?? 0) }} · {{ preview?.encoding }}</small>
        </div>
        <div class="summary-block">
          <span>当前结果</span>
          <strong>{{ chapters.length }} 章 / {{ volumeCount }} 卷</strong>
          <small>{{ formatNumber(totalCharacterCount) }} 字</small>
        </div>
        <n-button type="primary" block @click="proceedToSetup">确认拆章</n-button>
      </aside>
    </main>

    <main v-else-if="stage === 'setup'" class="setup-stage">
      <div class="stage-scroll">
        <section class="setup-form">
          <div class="section-heading">
            <FileText :size="19" />
            <div><h2>项目信息</h2><p>导入后会创建一个新的正式小说项目。</p></div>
          </div>
          <div class="form-grid">
            <label><span>作品名称</span><n-input v-model:value="projectForm.title" /></label>
            <label><span>题材</span><n-select v-model:value="projectForm.genre" :options="genreOptions" filterable /></label>
            <label><span>篇幅</span><n-select v-model:value="projectForm.novelLength" :options="[{ label: '长篇', value: 'long' }, { label: '短篇', value: 'short' }]" /></label>
            <label><span>目标平台</span><n-select v-model:value="projectForm.targetPlatform" :options="platformOptions" filterable tag /></label>
            <label class="full"><span>续写章节标题</span><n-input v-model:value="projectForm.nextChapterTitle" /></label>
          </div>
        </section>

        <section class="ai-setup">
          <div class="section-heading ai-heading">
            <Sparkles :size="19" />
            <div><h2>AI 整理</h2></div>
            <n-switch v-model:value="projectForm.useAi" />
          </div>
          <template v-if="projectForm.useAi">
            <n-alert v-if="!hasAiSettings" type="warning" :show-icon="false">需要先在主页设置中配置模型和 API Key。</n-alert>
            <div class="ai-options">
              <n-checkbox v-model:checked="projectForm.aiSummaries">章节摘要</n-checkbox>
              <n-checkbox v-model:checked="projectForm.aiCharacters">人物卡片</n-checkbox>
              <n-checkbox v-model:checked="projectForm.aiOutline">全书与分卷大纲</n-checkbox>
            </div>
            <label class="scope-field">
              <span>分析范围</span>
              <n-select v-model:value="projectForm.analysisScope" :options="scopeOptions" />
              <small>将分析 {{ analysisChapterCount }} 章，正文会发送给当前模型服务商。</small>
            </label>
          </template>
        </section>
      </div>

      <footer class="page-actions">
        <n-button @click="stage = 'review'">返回校对</n-button>
        <n-button v-if="projectForm.useAi" type="primary" :disabled="!hasAiSettings || !hasAiModule" @click="confirmAiAnalysis">
          <template #icon><Sparkles :size="17" /></template>
          开始分析
        </n-button>
        <n-button v-else type="primary" @click="createContinuationProject">创建项目并续写</n-button>
      </footer>
    </main>

    <main v-else-if="stage === 'analysis'" class="analysis-stage">
      <LoaderCircle class="spin" :size="30" />
      <h2>正在整理小说资料</h2>
      <p>{{ analysisMessage }}</p>
      <n-progress type="line" :percentage="analysisProgress" :height="7" />
      <n-button secondary @click="cancelAnalysis"><template #icon><Square :size="14" /></template>停止分析</n-button>
    </main>

    <main v-else class="ai-review-stage">
      <div class="stage-scroll">
        <section class="analysis-overview">
          <div class="section-heading"><ListTree :size="19" /><div><h2>剧情与续写状态</h2><p>{{ chapterAnalyses.length }} 章已生成结构化摘要</p></div></div>
          <label><span>已有剧情总览</span><textarea v-model="aggregateAnalysis!.bookSummary"></textarea></label>
          <label><span>当前续写状态</span><textarea v-model="aggregateAnalysis!.continuationStatus"></textarea></label>
        </section>
        <section v-if="projectForm.aiCharacters" class="character-review">
          <div class="section-heading"><Users :size="19" /><div><h2>人物卡片</h2><p>取消勾选可不导入该人物。</p></div></div>
          <div class="character-list">
            <label v-for="character in aggregateAnalysis?.characters" :key="character.name" class="character-item">
              <n-checkbox
                :checked="includedCharacterNames.includes(character.name)"
                @update:checked="toggleCharacter(character.name, $event)"
              />
              <span><strong>{{ character.name }}</strong><small>{{ character.role }}</small></span>
              <p>{{ character.description }}</p>
            </label>
          </div>
        </section>
        <section v-if="projectForm.aiOutline" class="volume-review">
          <div class="section-heading"><BookOpen :size="19" /><div><h2>分卷摘要</h2><p>{{ aggregateAnalysis?.volumeSummaries.length ?? 0 }} 个分卷</p></div></div>
          <div class="volume-list">
            <div v-for="volume in aggregateAnalysis?.volumeSummaries" :key="volume.title">
              <strong>{{ volume.title }}</strong><p>{{ volume.summary }}</p>
            </div>
          </div>
        </section>
      </div>
      <footer class="page-actions">
        <n-button @click="stage = 'setup'">返回设置</n-button>
        <n-button type="primary" @click="createContinuationProject">
          <template #icon><Check :size="17" /></template>
          应用结果并创建项目
        </n-button>
      </footer>
    </main>
  </section>
</template>

<style scoped>
.continuation-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: calc(var(--arc-titlebar-height) + 18px) clamp(18px, 3vw, 34px) 28px;
  background: var(--arc-bg-body);
  color: var(--arc-text-primary);
}

.continuation-header { display: flex; align-items: center; gap: 14px; min-height: 52px; }
.back-button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-surface); color: var(--arc-text-secondary); cursor: pointer; }
.back-button:hover { color: var(--arc-primary); border-color: var(--arc-primary); }
.header-copy { min-width: 0; }
.header-copy h1 { margin: 0; font-size: 21px; line-height: 1.2; letter-spacing: 0; }
.header-copy p { margin: 5px 0 0; color: var(--arc-text-hint); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.header-stats { display: flex; gap: 18px; margin-left: auto; color: var(--arc-text-hint); font-size: 12px; }
.header-stats strong { color: var(--arc-text-primary); font-size: 14px; }

.step-bar { display: grid; grid-template-columns: repeat(4, 1fr); margin: 18px 0; border-top: 1px solid var(--arc-border); border-bottom: 1px solid var(--arc-border); }
.step-item { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; color: var(--arc-text-hint); font-size: 13px; }
.step-item + .step-item { border-left: 1px solid var(--arc-border); }
.step-index { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1px solid var(--arc-border-strong); border-radius: 50%; font-size: 11px; }
.step-item.active { color: var(--arc-primary); font-weight: 700; background: var(--arc-primary-soft); }
.step-item.active .step-index, .step-item.done .step-index { border-color: var(--arc-primary); background: var(--arc-primary); color: white; }

.source-stage, .analysis-stage { display: flex; flex: 1; min-height: 420px; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.source-mark { display: inline-flex; align-items: center; justify-content: center; width: 62px; height: 62px; margin-bottom: 18px; border: 1px solid color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border)); border-radius: 8px; background: var(--arc-primary-soft); color: var(--arc-primary); }
.source-stage h2, .analysis-stage h2 { margin: 0; font-size: 22px; letter-spacing: 0; }
.source-stage p, .analysis-stage p { max-width: 520px; margin: 9px 0 22px; color: var(--arc-text-secondary); font-size: 13px; line-height: 1.7; }
.analysis-stage :deep(.n-progress) { width: min(520px, 78vw); margin-bottom: 22px; }
.spin { color: var(--arc-primary); animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.review-stage { display: grid; grid-template-columns: minmax(220px, 260px) minmax(420px, 1fr) minmax(210px, 240px); flex: 1; min-height: 0; border: 1px solid var(--arc-border); background: var(--arc-bg-surface); }
.chapter-rail { display: flex; min-height: 0; flex-direction: column; gap: 10px; padding: 12px; border-right: 1px solid var(--arc-border); background: var(--arc-bg-weak); }
.rail-head { display: flex; align-items: center; justify-content: space-between; }
.rail-head div { display: flex; flex-direction: column; }
.rail-head strong { font-size: 13px; }
.rail-head span { margin-top: 2px; color: var(--arc-text-hint); font-size: 11px; }
.chapter-list { min-height: 0; flex: 1; overflow-y: auto; }
.chapter-row { display: flex; width: 100%; flex-direction: column; gap: 3px; padding: 9px 10px; border: 0; border-left: 2px solid transparent; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.chapter-row:hover { background: var(--arc-bg-surface-hover); }
.chapter-row.active { border-left-color: var(--arc-primary); background: var(--arc-primary-soft); }
.chapter-row-title { overflow: hidden; font-size: 12.5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.chapter-row-meta { color: var(--arc-text-hint); font-size: 10.5px; }
.chapter-editor { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.editor-toolbar { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--arc-border); }
.editor-fields { display: grid; min-width: 0; flex: 1; grid-template-columns: minmax(180px, 1.4fr) minmax(130px, 0.8fr); gap: 8px; }
.editor-actions { display: flex; gap: 4px; }
.editor-actions button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--arc-border); border-radius: 4px; background: var(--arc-bg-surface); color: var(--arc-text-secondary); cursor: pointer; }
.editor-actions button:hover:not(:disabled) { color: var(--arc-primary); border-color: var(--arc-primary); }
.editor-actions button.danger:hover:not(:disabled) { color: var(--arc-danger); border-color: var(--arc-danger); }
.editor-actions button:disabled { opacity: 0.35; cursor: default; }
.content-editor { min-height: 0; flex: 1; resize: none; border: 0; outline: none; padding: 24px clamp(22px, 4vw, 54px); background: var(--arc-bg-surface); color: var(--arc-text-primary); font: 16px/1.95 "Noto Serif SC", "Source Han Serif SC", serif; letter-spacing: 0; }
.editor-footer { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 14px; border-top: 1px solid var(--arc-border); color: var(--arc-text-hint); font-size: 11px; }
.review-summary { display: flex; min-height: 0; flex-direction: column; gap: 10px; padding: 12px; border-left: 1px solid var(--arc-border); background: var(--arc-bg-weak); overflow-y: auto; }
.summary-block { display: flex; flex-direction: column; gap: 5px; padding: 12px 0; border-bottom: 1px solid var(--arc-border); }
.summary-block span, .summary-block small { color: var(--arc-text-hint); font-size: 11px; }
.summary-block strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; }

.setup-stage, .ai-review-stage { display: flex; width: min(100%, 920px); min-height: 0; flex: 1; flex-direction: column; margin: 0 auto; }
.stage-scroll { min-height: 0; flex: 1; overflow-y: auto; scrollbar-gutter: stable; }
.setup-form, .ai-setup, .analysis-overview, .character-review, .volume-review { padding: 22px 0; border-bottom: 1px solid var(--arc-border); }
.section-heading { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 18px; color: var(--arc-primary); }
.section-heading div { flex: 1; }
.section-heading h2 { margin: 0; color: var(--arc-text-primary); font-size: 16px; letter-spacing: 0; }
.section-heading p { margin: 4px 0 0; color: var(--arc-text-hint); font-size: 12px; }
.ai-heading { align-items: center; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.form-grid label, .scope-field, .analysis-overview label { display: flex; flex-direction: column; gap: 7px; color: var(--arc-text-secondary); font-size: 12px; }
.form-grid .full { grid-column: 1 / -1; }
.ai-options { display: flex; flex-wrap: wrap; gap: 22px; margin: 16px 0; }
.scope-field { max-width: 420px; }
.scope-field small { color: var(--arc-text-hint); line-height: 1.6; }
.page-actions { display: flex; flex: none; justify-content: flex-end; gap: 10px; padding-top: 22px; }
.setup-stage > .page-actions, .ai-review-stage > .page-actions { padding-bottom: 2px; background: var(--arc-bg-body); }
.analysis-overview textarea { min-height: 110px; resize: vertical; padding: 12px; border: 1px solid var(--arc-border); border-radius: 6px; outline: none; background: var(--arc-bg-surface); color: var(--arc-text-primary); font: inherit; line-height: 1.7; }
.analysis-overview textarea:focus { border-color: var(--arc-primary); }
.analysis-overview label + label { margin-top: 14px; }
.character-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.character-item { display: grid; grid-template-columns: 22px 120px 1fr; align-items: start; gap: 8px; min-height: 72px; padding: 12px; border: 1px solid var(--arc-border); border-radius: 6px; background: var(--arc-bg-surface); }
.character-item span { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.character-item strong { font-size: 13px; }
.character-item small { color: var(--arc-text-hint); font-size: 11px; }
.character-item p, .volume-list p { margin: 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; }
.volume-list { display: grid; gap: 10px; }
.volume-list > div { display: grid; grid-template-columns: minmax(140px, 190px) 1fr; gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--arc-border); }
.volume-list strong { font-size: 13px; }

@media (max-width: 1100px) {
  .review-stage { grid-template-columns: 220px minmax(400px, 1fr); }
  .review-summary { grid-column: 1 / -1; flex-direction: row; align-items: center; border-top: 1px solid var(--arc-border); border-left: 0; }
  .review-summary :deep(.n-alert) { display: none; }
  .review-summary .summary-block { min-width: 180px; padding: 0 12px 0 0; border-right: 1px solid var(--arc-border); border-bottom: 0; }
  .review-summary :deep(.n-button) { width: auto; margin-left: auto; }
}

@media (max-width: 820px) {
  .continuation-page { padding-inline: 12px; }
  .header-stats { display: none; }
  .step-item { font-size: 0; }
  .step-index { font-size: 11px; }
  .review-stage { grid-template-columns: 180px minmax(320px, 1fr); }
  .editor-toolbar { align-items: stretch; flex-direction: column; }
  .form-grid, .character-list { grid-template-columns: 1fr; }
}
</style>
