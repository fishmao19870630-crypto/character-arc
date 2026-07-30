import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { getWorkspaceDirPath } from './workspace-store'
import {
  parseQidianRankingHtml,
  type MarketPlatform,
  type MarketRankingBook,
  type MarketRankingCacheEnvelope,
  type MarketRankingProgress,
  type MarketRankingResult
} from './market-radar-parser'

export type { MarketPlatform, MarketRankingBook, MarketRankingProgress, MarketRankingResult } from './market-radar-parser'

type RankingConfig = {
  label: string
  sourceUrl: string
  script?: 'qimao-rank-scraper.js' | 'jjwxc-rank-scraper.js' | 'ciweimao-rank-scraper.js'
  args?: string[]
}

type ProgressReporter = (progress: Omit<MarketRankingProgress, 'requestId'>) => void

const PLATFORM_LABELS: Record<MarketPlatform, string> = {
  qidian: '起点中文网',
  qimao: '七猫小说',
  jjwxc: '晋江文学城',
  ciweimao: '刺猬猫'
}

const RANKINGS: Record<MarketPlatform, Record<string, RankingConfig>> = {
  qidian: {
    hotsales: { label: '畅销榜', sourceUrl: 'https://m.qidian.com/rank/hotsales/' },
    yuepiao: { label: '月票榜', sourceUrl: 'https://m.qidian.com/rank/yuepiao/' },
    signnewbook: { label: '签约榜', sourceUrl: 'https://m.qidian.com/rank/sign/' },
    pubnewbook: { label: '新书榜', sourceUrl: 'https://m.qidian.com/rank/newbook/' },
    newauthor: { label: '新人榜', sourceUrl: 'https://m.qidian.com/rank/newauthor/' },
    recom: { label: '推荐榜', sourceUrl: 'https://m.qidian.com/rank/rec/' },
    readindex: { label: '阅读指数榜', sourceUrl: 'https://m.qidian.com/rank/readindex/' }
  },
  qimao: Object.fromEntries(
    ['male', 'female'].flatMap((channel) =>
      [
        ['hot', '大热榜'],
        ['new', '新书榜'],
        ['finish', '完结榜'],
        ['collect', '收藏榜'],
        ['update', '更新榜']
      ].map(([type, label]) => [
        `${channel}:${type}`,
        {
          label: `${channel === 'male' ? '男频' : '女频'}${label}`,
          sourceUrl: 'https://www.qimao.com/paihang',
          script: 'qimao-rank-scraper.js',
          args: ['--channel', channel, '--type', type]
        }
      ])
    )
  ),
  jjwxc: Object.fromEntries([
    ['12', '收入金榜'],
    ['5', '月榜'],
    ['4', '季度榜'],
    ['16', '完结金榜'],
    ['17', '新手金榜'],
    ['21', '千字金榜']
  ].map(([type, label]) => [type, {
    label,
    sourceUrl: `https://www.jjwxc.net/topten.php?orderstr=${type}&t=0`,
    script: 'jjwxc-rank-scraper.js',
    args: ['--type', type, '--channel', '0', '--limit', '10']
  }])),
  ciweimao: Object.fromEntries([
    ['click', '点击榜'],
    ['favor', '收藏榜'],
    ['recommend', '推荐榜'],
    ['subscribe', '订阅榜'],
    ['monthly', '月票榜'],
    ['tsukkomi', '吐槽榜'],
    ['newbook', '新书榜'],
    ['blade', '刀片榜'],
    ['update', '更新榜']
  ].map(([type, label]) => [type, {
    label,
    sourceUrl: 'https://www.ciweimao.com/rank-index',
    script: 'ciweimao-rank-scraper.js',
    args: ['--type', type]
  }]))
}

const CACHE_TTL_MS = 30 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const SCRAPER_TIMEOUT_MS = 5 * 60 * 1000
const CACHE_DIR_NAME = 'market-radar-cache'
const CDP_PROFILE_DIR_NAME = 'market-radar-chrome'

let browserProcess: ChildProcess | null = null
let browserPort = 0
let browserPromise: Promise<number> | null = null
let browserHeadless = true
let scrapeQueue: Promise<void> = Promise.resolve()

function cachePath(platform: MarketPlatform, rankingType: string): string {
  return join(getWorkspaceDirPath(), CACHE_DIR_NAME, `${platform}-${rankingType.replace(/[^a-z0-9-]/gi, '_')}.json`)
}

async function readCache(platform: MarketPlatform, rankingType: string): Promise<MarketRankingCacheEnvelope | null> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(platform, rankingType), 'utf8')) as MarketRankingCacheEnvelope
    return parsed?.platform === platform && Array.isArray(parsed.books) && typeof parsed.fetchedAt === 'number' ? parsed : null
  } catch {
    return null
  }
}

async function writeCache(platform: MarketPlatform, rankingType: string, value: MarketRankingCacheEnvelope): Promise<void> {
  try {
    await mkdir(dirname(cachePath(platform, rankingType)), { recursive: true })
    await writeFile(cachePath(platform, rankingType), JSON.stringify(value), 'utf8')
  } catch {
    // 缓存失败不能覆盖成功的实时采集结果。
  }
}

function normalizePlatform(value: unknown): MarketPlatform | null {
  return value === 'qidian' || value === 'qimao' || value === 'jjwxc' || value === 'ciweimao' ? value : null
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function normalizeScraperResult(
  value: unknown,
  platform: Exclude<MarketPlatform, 'qidian'>,
  rankingType: string,
  config: Pick<RankingConfig, 'label' | 'sourceUrl'>
): MarketRankingCacheEnvelope {
  const root = asRecord(Array.isArray(value) ? value[0] : value)
  const rows = Array.isArray(root.books) ? root.books : []
  const usedIds = new Set<string>()
  const books = rows.map((item, index): MarketRankingBook | null => {
    const row = asRecord(item)
    const title = asText(row.title)
    if (!title) return null
    const baseId = asText(row.id) || String(index + 1)
    let id = `${platform}-${rankingType}-${baseId}`
    while (usedIds.has(id)) id = `${platform}-${rankingType}-${baseId}-${index + 1}`
    usedIds.add(id)
    return {
      id,
      rank: Number(row.rank) || index + 1,
      title,
      author: asText(row.author),
      category: asText(row.category),
      subcategory: asText(row.subcategory),
      wordCount: asText(row.wordCount),
      metric: asText(row.metric),
      description: asText(row.description),
      url: asText(row.url) || config.sourceUrl,
      status: asText(row.status)
    }
  }).filter((book): book is MarketRankingBook => Boolean(book))

  if (!books.length) throw new Error(`${PLATFORM_LABELS[platform]}采集脚本没有返回有效作品`)
  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform],
    rankingType,
    rankingLabel: config.label,
    sourceUrl: config.sourceUrl,
    fetchedAt: Number(root.fetchedAt) || Date.now(),
    books
  }
}

function findChromePath(): string {
  const candidates = [
    process.env.CHARACTERARC_CHROME_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter((candidate): candidate is string => Boolean(candidate))
  const chromePath = candidates.find(existsSync)
  if (!chromePath) throw new Error('未找到 Google Chrome，请安装 Chrome 或设置 CHARACTERARC_CHROME_PATH')
  return chromePath
}

function findNodePath(): string {
  const executable = process.platform === 'win32' ? 'node.exe' : 'node'
  const candidates = [
    process.env.CHARACTERARC_NODE_PATH,
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((directory) => join(directory, executable))
  ].filter((candidate): candidate is string => Boolean(candidate))
  const nodePath = candidates.find(existsSync)
  if (!nodePath) throw new Error('未找到 Node.js；请先安装 Node.js 和全局 agent-browser')
  return nodePath
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForCdp(port: number): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Chrome 尚未完成启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('Chrome 调试环境启动超时')
}

function stopBrowser(): void {
  const child = browserProcess
  browserProcess = null
  browserPromise = null
  browserPort = 0
  browserHeadless = true
  child?.kill()
}

async function startBrowser(headless: boolean, initialUrl: string): Promise<number> {
  browserPromise = (async () => {
    const port = await getFreePort()
    const profileDir = join(getWorkspaceDirPath(), CDP_PROFILE_DIR_NAME)
    await mkdir(profileDir, { recursive: true })
    const chromeArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--remote-allow-origins=*',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      initialUrl
    ]
    if (headless) chromeArgs.splice(3, 0, '--headless=new')
    const child = spawn(findChromePath(), chromeArgs, { stdio: 'ignore', windowsHide: headless })
    child.once('exit', () => {
      if (browserProcess === child) stopBrowser()
    })
    browserProcess = child
    browserHeadless = headless
    await waitForCdp(port)
    browserPort = port
    return port
  })().catch((error) => {
    stopBrowser()
    throw error
  })

  return browserPromise
}

async function ensureBrowser(): Promise<number> {
  if (browserProcess && !browserProcess.killed && browserPort) return browserPort
  if (browserPromise) return browserPromise
  return startBrowser(true, 'about:blank')
}

const PLATFORM_LOGIN_URLS: Record<Exclude<MarketPlatform, 'qidian'>, string> = {
  qimao: 'https://www.qimao.com/',
  jjwxc: 'https://www.jjwxc.net/',
  ciweimao: 'https://www.ciweimao.com/'
}

export async function openMarketPlatformLogin(
  platformValue: unknown
): Promise<{ success: true } | { success: false; error: string }> {
  const platform = normalizePlatform(platformValue)
  if (!platform || platform === 'qidian') return { success: false, error: '该平台不需要浏览器登录' }
  const loginUrl = PLATFORM_LOGIN_URLS[platform]
  try {
    if (browserProcess && !browserHeadless && browserPort) {
      await fetch(`http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(loginUrl)}`, { method: 'PUT' })
      return { success: true }
    }
    if (browserProcess) {
      stopBrowser()
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    await startBrowser(false, loginUrl)
    return { success: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { success: false, error: `打开${PLATFORM_LABELS[platform]}登录窗口失败：${reason}` }
  }
}

app.once('before-quit', stopBrowser)

function resolveScraperPath(script: NonNullable<RankingConfig['script']>): string {
  const relative = join('resources', 'skills', 'oh-story-claudecode', 'story-long-scan', 'scripts', script)
  return app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', relative)
    : join(app.getAppPath(), relative)
}

async function runScript(
  platform: Exclude<MarketPlatform, 'qidian'>,
  rankingType: string,
  config: RankingConfig,
  report: ProgressReporter
): Promise<MarketRankingCacheEnvelope> {
  const tempDir = await mkdtemp(join(tmpdir(), 'characterarc-market-'))
  const jsonPath = join(tempDir, 'result.json')
  try {
    report({ platform, phase: 'browser', percent: 15, message: '正在启动专用 Chrome 采集环境…' })
    const port = await ensureBrowser()
    report({ platform, phase: 'collecting', percent: 30, message: `正在采集${PLATFORM_LABELS[platform]}公开榜单…` })

    const scriptPath = resolveScraperPath(config.script!)
    if (!existsSync(scriptPath)) throw new Error(`采集脚本不存在：${scriptPath}`)
    const outputDir = join(getWorkspaceDirPath(), CACHE_DIR_NAME, 'reports')
    await mkdir(outputDir, { recursive: true })
    const args = [scriptPath, ...(config.args ?? []), '--port', String(port), '--outdir', outputDir, '--json-output', jsonPath]

    await new Promise<void>((resolve, reject) => {
      const child = spawn(findNodePath(), args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`${PLATFORM_LABELS[platform]}采集超时`))
      }, SCRAPER_TIMEOUT_MS)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        const percent = chunk.includes('已保存') || chunk.includes('条 →') ? 90 : chunk.includes('提取') ? 80 : 45
        const message = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)
        if (message) report({ platform, phase: 'collecting', percent, message: message.replace(/^[→✓⚠]\s*/, '') })
      })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || stdout.trim() || `采集脚本退出码 ${code}`))
      })
    })

    report({ platform, phase: 'processing', percent: 94, message: '正在整理并校验榜单数据…' })
    return normalizeScraperResult(JSON.parse(await readFile(jsonPath, 'utf8')), platform, rankingType, config)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function runQueued<T>(task: () => Promise<T>): Promise<T> {
  let release!: () => void
  const previous = scrapeQueue
  scrapeQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

async function fetchQidian(rankingType: string, config: RankingConfig): Promise<MarketRankingCacheEnvelope> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(config.sourceUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseQidianRankingHtml(await response.text(), rankingType, config.label, config.sourceUrl)
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchMarketRanking(
  platformValue: unknown,
  rankingTypeValue: unknown,
  force = false,
  report: ProgressReporter = () => {}
): Promise<{ success: true; result: MarketRankingResult } | { success: false; error: string }> {
  const platform = normalizePlatform(platformValue)
  if (!platform) return { success: false, error: '不支持的小说平台' }
  const rankingType = typeof rankingTypeValue === 'string' ? rankingTypeValue.trim() : ''
  const config = RANKINGS[platform][rankingType]
  if (!config) return { success: false, error: `不支持的${PLATFORM_LABELS[platform]}榜单类型` }

  const cached = await readCache(platform, rankingType)
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    report({ platform, phase: 'done', percent: 100, message: '已读取本地缓存' })
    return { success: true, result: { ...cached, fromCache: true } }
  }

  try {
    if (platform === 'qidian') {
      report({ platform, phase: 'collecting', percent: 25, message: '正在请求起点公开榜单接口…' })
    }
    const result = platform === 'qidian'
      ? await fetchQidian(rankingType, config)
      : await runQueued(() => runScript(platform, rankingType, config, report))
    await writeCache(platform, rankingType, result)
    report({ platform, phase: 'done', percent: 100, message: `已获取 ${result.books.length} 本作品` })
    return { success: true, result: { ...result, fromCache: false } }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? '请求超时'
      : error instanceof Error ? error.message : '未知错误'
    if (cached) {
      report({ platform, phase: 'done', percent: 100, message: '实时采集失败，已回退到历史缓存' })
      return {
        success: true,
        result: { ...cached, fromCache: true, warning: `实时采集失败，当前展示历史缓存：${reason}` }
      }
    }
    report({ platform, phase: 'error', percent: 100, message: reason })
    return { success: false, error: `获取${PLATFORM_LABELS[platform]}榜单失败：${reason}` }
  }
}
