<script setup lang="ts">
import { BarChart3, ChevronLeft, ExternalLink, Flame, LogIn, RefreshCw, Sparkles } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'

import { useAppStore } from '@/stores/app'

type MarketBook = {
  id: string
  rank: number
  title: string
  author: string
  category: string
  subcategory: string
  wordCount: string
  metric: string
  description: string
  url: string
  status?: string
}

type RankingResult = {
  platform: MarketPlatform
  platformLabel: string
  rankingType: string
  rankingLabel: string
  sourceUrl: string
  fetchedAt: number
  fromCache: boolean
  warning?: string
  books: MarketBook[]
}

type MarketPlatform = 'qidian' | 'qimao' | 'jjwxc' | 'ciweimao'

type CollectionProgress = {
  requestId: string
  platform: MarketPlatform
  phase: 'browser' | 'collecting' | 'processing' | 'done' | 'error'
  percent: number
  message: string
}

type MarketAnalysis = {
  summary: string
  patterns: Array<{ label: string; evidence: string; writingTechnique: string }>
  originalConcepts: Array<{
    title: string
    premise: string
    differentiation: string
    targetAudience: string
    outline: string[]
  }>
}

const appStore = useAppStore()
const message = useMessage()
const platform = ref<MarketPlatform>('qidian')
const rankingType = ref('yuepiao')
const loading = ref(false)
const analyzing = ref(false)
const loggingIn = ref(false)
const errorMessage = ref('')
const ranking = ref<RankingResult | null>(null)
const selectedIds = ref<string[]>([])
const analysis = ref<MarketAnalysis | null>(null)
const progress = ref<CollectionProgress | null>(null)
let activeRequestId = ''
let stopProgressListener: (() => void) | null = null

const platforms: Array<{ value: MarketPlatform; label: string; hint: string }> = [
  { value: 'qidian', label: '起点中文网', hint: '实时接口' },
  { value: 'qimao', label: '七猫小说', hint: '浏览器采集' },
  { value: 'jjwxc', label: '晋江文学城', hint: '浏览器采集' },
  { value: 'ciweimao', label: '刺猬猫', hint: '浏览器采集' }
]

const rankingOptionsByPlatform: Record<MarketPlatform, Array<{ value: string; label: string }>> = {
  qidian: [
    { value: 'yuepiao', label: '月票榜' }, { value: 'hotsales', label: '畅销榜' },
    { value: 'readindex', label: '阅读指数榜' }, { value: 'signnewbook', label: '签约榜' },
    { value: 'pubnewbook', label: '新书榜' }, { value: 'newauthor', label: '新人榜' },
    { value: 'recom', label: '推荐榜' }
  ],
  qimao: [
    { value: 'male:hot', label: '男频大热榜' }, { value: 'female:hot', label: '女频大热榜' },
    { value: 'male:new', label: '男频新书榜' }, { value: 'female:new', label: '女频新书榜' },
    { value: 'male:finish', label: '男频完结榜' }, { value: 'female:finish', label: '女频完结榜' },
    { value: 'male:collect', label: '男频收藏榜' }, { value: 'female:collect', label: '女频收藏榜' },
    { value: 'male:update', label: '男频更新榜' }, { value: 'female:update', label: '女频更新榜' }
  ],
  jjwxc: [
    { value: '12', label: '收入金榜' }, { value: '5', label: '月榜' },
    { value: '4', label: '季度榜' }, { value: '16', label: '完结金榜' },
    { value: '17', label: '新手金榜' }, { value: '21', label: '千字金榜' }
  ],
  ciweimao: [
    { value: 'click', label: '点击榜' }, { value: 'favor', label: '收藏榜' },
    { value: 'recommend', label: '推荐榜' }, { value: 'subscribe', label: '订阅榜' },
    { value: 'monthly', label: '月票榜' }, { value: 'tsukkomi', label: '吐槽榜' },
    { value: 'newbook', label: '新书榜' }, { value: 'blade', label: '刀片榜' },
    { value: 'update', label: '更新榜' }
  ]
}

const rankingOptions = computed(() => rankingOptionsByPlatform[platform.value])
const platformLabel = computed(() => platforms.find((item) => item.value === platform.value)?.label ?? '')

const selectedBooks = computed(() => {
  const selected = new Set(selectedIds.value)
  return ranking.value?.books.filter((book) => selected.has(book.id)).slice(0, 10) ?? []
})

const fetchedAtLabel = computed(() => ranking.value
  ? new Date(ranking.value.fetchedAt).toLocaleString('zh-CN', { hour12: false })
  : '')

function toggleBook(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((item) => item !== id)
    : selectedIds.value.length < 10 ? [...selectedIds.value, id] : selectedIds.value
  if (!selectedIds.value.includes(id) && selectedIds.value.length >= 10) {
    message.warning('一次最多选择 10 本作品')
  }
}

function selectTopFive(): void {
  selectedIds.value = ranking.value?.books.slice(0, 5).map((book) => book.id) ?? []
}

async function loadRanking(force = false): Promise<void> {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  activeRequestId = requestId
  loading.value = true
  errorMessage.value = ''
  analysis.value = null
  ranking.value = null
  selectedIds.value = []
  progress.value = {
    requestId,
    platform: platform.value,
    phase: 'collecting',
    percent: 5,
    message: '正在准备榜单采集…'
  }
  try {
    const response = await window.characterArc.fetchMarketRanking(platform.value, rankingType.value, force, requestId)
    if (activeRequestId !== requestId) return
    if (!response.success || !response.result) {
      throw new Error(response.error || '榜单加载失败')
    }
    ranking.value = response.result
    selectedIds.value = response.result.books.slice(0, 5).map((book) => book.id)
  } catch (error) {
    if (activeRequestId !== requestId) return
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (activeRequestId === requestId) loading.value = false
  }
}

function selectPlatform(nextPlatform: MarketPlatform): void {
  if (loading.value || platform.value === nextPlatform) return
  platform.value = nextPlatform
  rankingType.value = rankingOptionsByPlatform[nextPlatform][0].value
  void loadRanking()
}

async function openPlatformLogin(): Promise<void> {
  if (platform.value === 'qidian') return
  loggingIn.value = true
  try {
    const response = await window.characterArc.openMarketPlatformLogin(platform.value)
    if (!response.success) throw new Error(response.error || '登录窗口打开失败')
    message.success(`已打开${platformLabel.value}专用登录窗口；登录完成后返回市场雷达刷新榜单`)
  } catch (error) {
    message.error(error instanceof Error ? error.message : '登录窗口打开失败')
  } finally {
    loggingIn.value = false
  }
}

async function analyzeSelection(): Promise<void> {
  if (!selectedBooks.value.length) {
    message.warning('请先选择至少一本作品')
    return
  }

  analyzing.value = true
  analysis.value = null
  try {
    const response = await window.characterArc.generateAi({
      task: 'market-analysis',
      settings: appStore.appSettings,
      context: {
        platformLabel: ranking.value?.platformLabel,
        rankingLabel: ranking.value?.rankingLabel,
        books: selectedBooks.value.map((book) => ({
          rank: book.rank,
          title: book.title,
          author: book.author,
          category: [book.category, book.subcategory].filter(Boolean).join('·'),
          wordCount: book.wordCount,
          metric: book.metric,
          description: book.description
        }))
      }
    })
    if (!response.success || !response.result) {
      throw new Error(response.error || 'AI 分析失败')
    }
    analysis.value = response.result as MarketAnalysis
  } catch (error) {
    message.error(error instanceof Error ? error.message : 'AI 分析失败')
  } finally {
    analyzing.value = false
  }
}

function openUrl(url: string): void {
  void window.characterArc.openExternalUrl(url)
}

onMounted(() => {
  stopProgressListener = window.characterArc.onMarketRankingProgress((payload) => {
    if (payload.requestId === activeRequestId) progress.value = payload
  })
  void loadRanking()
})

onBeforeUnmount(() => stopProgressListener?.())
</script>

<template>
  <section class="market-page arc-scrollbar">
    <div class="market-shell">
      <header class="topbar">
        <div>
          <n-button quaternary size="small" @click="appStore.backToProjects()">
            <template #icon><ChevronLeft :size="16" /></template>
            返回项目中心
          </n-button>
          <h1><BarChart3 :size="26" /> 市场雷达</h1>
          <p>查看公开榜单元数据，提炼市场信号，再生成有明显差异的原创选题。</p>
        </div>
        <div class="topbar-actions">
          <n-button v-if="platform !== 'qidian'" :loading="loggingIn" :disabled="loading" @click="openPlatformLogin">
            <template #icon><LogIn :size="15" /></template>
            登录/验证平台
          </n-button>
          <n-button :loading="loading" @click="loadRanking(true)">
            <template #icon><RefreshCw :size="15" /></template>
            刷新榜单
          </n-button>
        </div>
      </header>

      <div class="platforms" aria-label="小说平台选择">
        <button
          v-for="item in platforms"
          :key="item.value"
          class="platform"
          :class="{ active: platform === item.value }"
          :disabled="loading"
          @click="selectPlatform(item.value)"
        ><span>{{ item.label }}</span><small>{{ item.hint }}</small></button>
        <button class="platform fanqie" @click="appStore.openFanqieTrends()"><span>番茄小说</span><small>趋势数据</small></button>
      </div>

      <div class="notice">
        <Flame :size="17" />
        <span>只分析公开榜单、分类和简介。不会抓取付费正文，也不会复制专有设定、角色、桥段顺序或原文表达。</span>
      </div>

      <div class="controls">
        <label>
          {{ platformLabel }}榜单
          <select v-model="rankingType" :disabled="loading" @change="loadRanking()">
            <option v-for="option in rankingOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div v-if="ranking" class="source-meta">
          {{ ranking.fromCache ? '本地缓存' : '实时获取' }} · {{ fetchedAtLabel }} · {{ ranking.books.length }} 本
          <button @click="openUrl(ranking.sourceUrl)">查看来源 <ExternalLink :size="13" /></button>
        </div>
      </div>

      <div v-if="loading" class="state progress-state">
        <strong>{{ progress?.message || '正在获取公开榜单…' }}</strong>
        <progress :value="progress?.percent ?? 5" max="100"></progress>
        <span>{{ progress?.percent ?? 5 }}%</span>
        <small v-if="platform !== 'qidian'">首次采集会启动后台 Chrome，通常需要数十秒。</small>
      </div>
      <div v-else-if="errorMessage" class="state error">
        <strong>榜单加载失败</strong>
        <span>{{ errorMessage }}</span>
        <n-button size="small" @click="loadRanking(true)">重试</n-button>
      </div>

      <template v-else-if="ranking">
        <div v-if="ranking.warning" class="cache-warning">{{ ranking.warning }}</div>
        <div class="selection-bar">
          <span>已选 {{ selectedBooks.length }} / 10 本作为分析样本</span>
          <div>
            <n-button size="small" quaternary @click="selectTopFive">选择前 5 名</n-button>
            <n-button type="primary" size="small" :loading="analyzing" @click="analyzeSelection">
              <template #icon><Sparkles :size="15" /></template>
              AI 趋势分析与原创策划
            </n-button>
          </div>
        </div>

        <div class="book-grid">
          <article
            v-for="book in ranking.books"
            :key="book.id"
            class="book-card"
            :class="{ selected: selectedIds.includes(book.id) }"
            @click="toggleBook(book.id)"
          >
            <div class="book-rank">#{{ book.rank }}</div>
            <input type="checkbox" :checked="selectedIds.includes(book.id)" aria-label="选择作品" @click.stop="toggleBook(book.id)">
            <h2>{{ book.title }}</h2>
            <p class="book-author">{{ book.author || '作者未知' }}</p>
            <div class="tags">
              <span v-if="book.category">{{ book.category }}</span>
              <span v-if="book.subcategory">{{ book.subcategory }}</span>
              <span v-if="book.wordCount">{{ book.wordCount }}</span>
              <span v-if="book.status">{{ book.status }}</span>
            </div>
            <strong class="metric">{{ book.metric || '暂无榜单值' }}</strong>
            <p class="description">{{ book.description || '暂无简介' }}</p>
            <button class="book-link" @click.stop="openUrl(book.url)">作品页 <ExternalLink :size="13" /></button>
          </article>
        </div>
      </template>

      <section v-if="analysis" class="analysis-section">
        <div class="analysis-heading">
          <Sparkles :size="22" />
          <div><h2>AI 市场分析</h2><p>结果基于当前选择的公开元数据，不代表平台完整市场。</p></div>
        </div>
        <p class="analysis-summary">{{ analysis.summary }}</p>

        <h3>可迁移的写作规律</h3>
        <div class="pattern-grid">
          <article v-for="pattern in analysis.patterns" :key="pattern.label">
            <h4>{{ pattern.label }}</h4>
            <p><strong>依据：</strong>{{ pattern.evidence }}</p>
            <p><strong>技巧：</strong>{{ pattern.writingTechnique }}</p>
          </article>
        </div>

        <h3>原创选题与五阶段大纲</h3>
        <div class="concept-grid">
          <article v-for="concept in analysis.originalConcepts" :key="concept.title">
            <h4>{{ concept.title }}</h4>
            <p>{{ concept.premise }}</p>
            <dl>
              <dt>差异化</dt><dd>{{ concept.differentiation }}</dd>
              <dt>目标读者</dt><dd>{{ concept.targetAudience }}</dd>
            </dl>
            <ol><li v-for="step in concept.outline" :key="step">{{ step }}</li></ol>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.market-page { height: 100%; overflow-y: auto; color: var(--arc-text-primary); }
.market-shell { width: min(1380px, calc(100% - 48px)); margin: 0 auto; padding: 30px 0 64px; }
.topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.topbar-actions { display: flex; gap: 8px; }
.topbar h1 { display: flex; align-items: center; gap: 10px; margin: 18px 0 6px; font-size: 30px; }
.topbar p, .source-meta, .analysis-heading p { margin: 0; color: var(--arc-text-secondary); }
.platforms { display: grid; grid-template-columns: repeat(5, minmax(140px, 1fr)); gap: 10px; margin: 26px 0 16px; }
.platform { display: flex; flex-direction: column; gap: 4px; padding: 13px 15px; text-align: left; color: var(--arc-text-primary); background: var(--arc-bg-secondary); border: 1px solid var(--arc-border); border-radius: 12px; cursor: pointer; }
.platform small { color: var(--arc-text-secondary); }
.platform.active { border-color: var(--arc-primary); box-shadow: 0 0 0 1px color-mix(in srgb, var(--arc-primary) 32%, transparent); }
.platform.fanqie { cursor: pointer; }
.platform:disabled { cursor: wait; opacity: .65; }
.notice { display: flex; align-items: center; gap: 9px; padding: 11px 14px; color: var(--arc-text-secondary); background: color-mix(in srgb, var(--arc-primary) 7%, var(--arc-bg-secondary)); border: 1px solid var(--arc-border); border-radius: 10px; font-size: 13px; }
.controls, .selection-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 18px 0; }
.controls label { display: flex; align-items: center; gap: 10px; font-weight: 600; }
select { min-width: 150px; padding: 8px 12px; color: var(--arc-text-primary); background: var(--arc-bg-secondary); border: 1px solid var(--arc-border); border-radius: 8px; }
.source-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.source-meta button, .book-link { display: inline-flex; align-items: center; gap: 4px; padding: 0; color: var(--arc-primary); background: none; border: 0; cursor: pointer; }
.state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 70px 20px; color: var(--arc-text-secondary); }
.state.error { color: #d65757; }
.progress-state progress { width: min(440px, 80%); height: 10px; accent-color: var(--arc-primary); }
.progress-state small { color: var(--arc-text-tertiary, var(--arc-text-secondary)); }
.cache-warning { margin: 0 0 14px; padding: 11px 14px; color: #b26a16; background: color-mix(in srgb, #e69836 12%, var(--arc-bg-secondary)); border: 1px solid color-mix(in srgb, #e69836 35%, var(--arc-border)); border-radius: 10px; font-size: 13px; }
.selection-bar { position: sticky; top: 0; z-index: 4; padding: 12px 14px; background: color-mix(in srgb, var(--arc-bg-primary) 92%, transparent); border: 1px solid var(--arc-border); border-radius: 11px; backdrop-filter: blur(12px); }
.selection-bar > div { display: flex; gap: 8px; }
.book-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.book-card { position: relative; min-height: 270px; padding: 18px; background: var(--arc-bg-secondary); border: 1px solid var(--arc-border); border-radius: 13px; cursor: pointer; transition: border-color .15s, transform .15s; }
.book-card:hover { transform: translateY(-1px); }
.book-card.selected { border-color: var(--arc-primary); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--arc-primary) 34%, transparent); }
.book-card input { position: absolute; top: 17px; right: 17px; accent-color: var(--arc-primary); }
.book-rank { color: var(--arc-primary); font-weight: 800; font-size: 13px; }
.book-card h2 { margin: 8px 28px 3px 0; font-size: 19px; }
.book-author { margin: 0 0 10px; color: var(--arc-text-secondary); font-size: 13px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tags span { padding: 3px 7px; background: var(--arc-bg-tertiary); border-radius: 999px; color: var(--arc-text-secondary); font-size: 12px; }
.metric { display: block; margin: 12px 0 6px; color: #e0842b; font-size: 13px; }
.description { display: -webkit-box; overflow: hidden; margin: 0 0 14px; color: var(--arc-text-secondary); line-height: 1.65; font-size: 13px; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.analysis-section { margin-top: 32px; padding-top: 28px; border-top: 1px solid var(--arc-border); }
.analysis-heading { display: flex; align-items: center; gap: 11px; }
.analysis-heading h2 { margin: 0 0 4px; }
.analysis-summary { padding: 16px; line-height: 1.75; background: var(--arc-bg-secondary); border-radius: 12px; }
.analysis-section > h3 { margin: 26px 0 12px; }
.pattern-grid, .concept-grid { display: grid; gap: 12px; }
.pattern-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.concept-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pattern-grid article, .concept-grid article { padding: 17px; background: var(--arc-bg-secondary); border: 1px solid var(--arc-border); border-radius: 12px; }
.pattern-grid h4, .concept-grid h4 { margin: 0 0 10px; font-size: 17px; }
.pattern-grid p, .concept-grid p, dd, li { color: var(--arc-text-secondary); line-height: 1.65; }
dl { display: grid; grid-template-columns: 64px 1fr; gap: 7px; margin: 14px 0; font-size: 13px; }
dt { color: var(--arc-text-primary); font-weight: 700; } dd { margin: 0; } ol { padding-left: 20px; }
@media (max-width: 1000px) { .platforms { grid-template-columns: repeat(2, 1fr); } .book-grid, .pattern-grid, .concept-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) { .market-shell { width: min(100% - 24px, 1380px); } .topbar, .controls, .selection-bar { align-items: stretch; flex-direction: column; } .topbar-actions { flex-wrap: wrap; } .book-grid, .pattern-grid, .concept-grid { grid-template-columns: 1fr; } .source-meta { flex-wrap: wrap; } }
</style>
