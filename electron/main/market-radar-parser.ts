export type MarketPlatform = 'qidian' | 'qimao' | 'jjwxc' | 'ciweimao'

export type MarketRankingProgress = {
  requestId: string
  platform: MarketPlatform
  phase: 'browser' | 'collecting' | 'processing' | 'done' | 'error'
  percent: number
  message: string
}

export type MarketRankingBook = {
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

export type MarketRankingResult = {
  platform: MarketPlatform
  platformLabel: string
  rankingType: string
  rankingLabel: string
  sourceUrl: string
  fetchedAt: number
  fromCache: boolean
  warning?: string
  books: MarketRankingBook[]
}

export type MarketRankingCacheEnvelope = Omit<MarketRankingResult, 'fromCache'>

const MOBILE_BASE_URL = 'https://m.qidian.com'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

export function parseQidianRankingHtml(
  html: string,
  rankingType: string,
  rankingLabel: string,
  sourceUrl: string,
  fetchedAt = Date.now()
): MarketRankingCacheEnvelope {
  const match = html.match(/<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match) throw new Error('起点页面缺少榜单数据，页面结构可能已经变化')

  let payload: unknown
  try {
    payload = JSON.parse(match[1])
  } catch {
    throw new Error('起点榜单数据解析失败')
  }

  const root = asRecord(payload)
  const pageContext = asRecord(root.pageContext)
  const pageProps = asRecord(pageContext.pageProps)
  const pageData = asRecord(pageProps.pageData)
  const records = Array.isArray(pageData.records) ? pageData.records : []
  const books = records.map((item, index): MarketRankingBook | null => {
    const record = asRecord(item)
    const id = asText(record.bid ?? record.bookId)
    const title = asText(record.bName ?? record.bookName)
    if (!title) return null

    return {
      id: id || `${rankingType}-${index + 1}`,
      rank: Number(record.rankNum) || index + 1,
      title,
      author: asText(record.bAuth ?? record.author),
      category: asText(record.cat),
      subcategory: asText(record.subCat),
      wordCount: asText(record.cnt),
      metric: asText(record.rankCnt),
      description: asText(record.desc),
      url: id ? `${MOBILE_BASE_URL}/book/${id}/` : sourceUrl
    }
  }).filter((book): book is MarketRankingBook => Boolean(book))

  if (!books.length) throw new Error('起点榜单没有返回有效作品')

  return {
    platform: 'qidian',
    platformLabel: '起点中文网',
    rankingType,
    rankingLabel,
    sourceUrl,
    fetchedAt,
    books
  }
}
