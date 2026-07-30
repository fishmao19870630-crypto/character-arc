import assert from 'node:assert/strict'
import test from 'node:test'

import { parseQidianRankingHtml } from './market-radar-parser.ts'

test('解析起点移动端 SSR 榜单为统一作品模型', () => {
  const pageContext = {
    pageContext: {
      pageProps: {
        pageData: {
          records: [{
            bid: '123',
            rankNum: 1,
            bName: '测试小说',
            bAuth: '测试作者',
            cat: '玄幻',
            subCat: '东方玄幻',
            cnt: '100万字',
            rankCnt: '9999月票',
            desc: '测试简介'
          }]
        }
      }
    }
  }
  const html = `<html><script id="vite-plugin-ssr_pageContext" type="application/json">${JSON.stringify(pageContext)}</script></html>`
  const result = parseQidianRankingHtml(html, 'yuepiao', '月票榜', 'https://m.qidian.com/rank/yuepiao/', 1234)

  assert.equal(result.platform, 'qidian')
  assert.equal(result.fetchedAt, 1234)
  assert.deepEqual(result.books[0], {
    id: '123',
    rank: 1,
    title: '测试小说',
    author: '测试作者',
    category: '玄幻',
    subcategory: '东方玄幻',
    wordCount: '100万字',
    metric: '9999月票',
    description: '测试简介',
    url: 'https://m.qidian.com/book/123/'
  })
})

test('页面结构变化时返回明确错误', () => {
  assert.throws(
    () => parseQidianRankingHtml('<html></html>', 'yuepiao', '月票榜', 'https://m.qidian.com'),
    /页面结构可能已经变化/
  )
})
