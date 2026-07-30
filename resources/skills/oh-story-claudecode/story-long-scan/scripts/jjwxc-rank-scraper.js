#!/usr/bin/env node
/**
 * 晋江文学城排行榜采集脚本
 *
 * 配合 browser-cdp skill 使用。先启动 Chrome CDP 环境，再运行本脚本。
 * 采集策略：从榜单 DOM 精确提取频道、书名、作者和作品链接，随后并发访问详情页，
 * 补齐字数、收藏数、营养液、积分、状态、题材与简介。
 * 输出 Markdown 格式匹配 scan-output-format.md 规范。
 *
 * 用法：
 *   node jjwxc-rank-scraper.js --type 12              # 收入金榜
 *   node jjwxc-rank-scraper.js --type 5               # 月榜
 *   node jjwxc-rank-scraper.js --type 4               # 季度榜
 *   node jjwxc-rank-scraper.js --type 16              # 完结金榜
 *   node jjwxc-rank-scraper.js --type all             # 全部榜单
 *   node jjwxc-rank-scraper.js --type 12 --limit 10   # 每频道前 10 本（默认）
 *
 * 前置：
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSON, getArg } = require("./cdp-utils");

const BASE_URL = "https://www.jjwxc.net/topten.php";

const RANK_TYPES = [
  { id: "12", label: "收入金榜" },
  { id: "5", label: "月榜" },
  { id: "4", label: "季度榜" },
  { id: "16", label: "完结金榜" },
  { id: "17", label: "新手金榜" },
  { id: "21", label: "千字金榜" },
];

// ---------------------------------------------------------------------------
// 页面提取
// ---------------------------------------------------------------------------

function extractRankData(port, limit) {
  const js = `(async()=>{
    const clean=(value)=>String(value||'').replace(/\\s+/g,' ').trim();
    const channels=[];
    for(const heading of document.querySelectorAll('h5')){
      const list=heading.nextElementSibling;
      if(!list||list.tagName!=='UL')continue;
      const books=Array.from(list.querySelectorAll(':scope > li')).slice(0,${limit}).map((item,index)=>{
        const links=item.querySelectorAll('a');
        const titleLink=links[0];
        const authorLink=links[1];
        return {
          rank:index+1,
          title:clean(titleLink?.textContent),
          author:clean(authorLink?.textContent),
          url:titleLink ? new URL(titleLink.getAttribute('href'),location.href).href : ''
        };
      }).filter((book)=>book.title&&book.author&&book.url);
      if(books.length)channels.push({name:clean(heading.textContent),books});
    }

    if(!channels.length){
      const table=Array.from(document.querySelectorAll('table')).find((candidate)=>{
        const header=clean(candidate.querySelector('tr')?.textContent);
        return header.includes('序号')&&header.includes('作者')&&header.includes('作品')&&header.includes('类型');
      });
      if(table){
        const books=Array.from(table.querySelectorAll('tr')).slice(1).map((row)=>{
          const cells=Array.from(row.querySelectorAll('td'));
          if(cells.length<7)return null;
          const titleLink=cells[2]?.querySelector('a[href]');
          const rank=Number(clean(cells[0]?.textContent));
          return {
            rank,
            title:clean(titleLink?.textContent||cells[2]?.textContent),
            author:clean(cells[1]?.textContent),
            url:titleLink ? new URL(titleLink.getAttribute('href'),location.href).href : '',
            genre:clean(cells[3]?.textContent),
            status:clean(cells[4]?.textContent),
            words:clean(cells[5]?.textContent),
            score:clean(cells[6]?.textContent)
          };
        }).filter((book)=>book&&book.rank&&book.title&&book.author&&book.url).slice(0,${limit});
        if(books.length)channels.push({name:'全站',books});
      }
    }

    const allBooks=channels.flatMap((channel)=>channel.books);
    let cursor=0;
    async function worker(){
      while(cursor<allBooks.length){
        const book=allBooks[cursor++];
        try{
          const response=await fetch(book.url,{credentials:'include'});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const html=new TextDecoder('gb18030').decode(await response.arrayBuffer());
          const doc=new DOMParser().parseFromString(html,'text/html');
          const text=(selector)=>clean(doc.querySelector(selector)?.textContent);
          book.genre=text('[itemprop="genre"]');
          book.status=text('[itemprop="updataStatus"]');
          book.words=text('[itemprop="wordCount"]');
          book.collects=text('[itemprop="collectedCount"]');
          book.nutrition=text('[itemprop="nutritionCount"]');
          book.score=text('[itemprop="scoreCount"]');
          book.totalClick=text('[itemprop="totalClick"]');
          book.reviews=text('[itemprop="reviewCount"]');
          book.desc=text('[itemprop="description"]');
        }catch(error){
          book.detailError=String(error?.message||error);
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(8,allBooks.length)},worker));
    return JSON.stringify({channels});
  })()`;
  return evalJSON(port, js);
}

function truncateDescription(text, max = 100) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const end = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  return `${head.slice(0, end >= max / 2 ? end + 1 : max)}...`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const JSON_OUTPUT = getArg(args, "--json-output");
const RANKTYPE = getArg(args, "--type") || "12";
const CHANNEL = getArg(args, "--channel") || "0";
const LIMIT = Math.min(50, Math.max(1, parseInt(getArg(args, "--limit") || "10", 10) || 10));

function scrapeRank(port, rankTypeId, channelId) {
  const rt = RANK_TYPES.find((r) => r.id === rankTypeId);
  if (!rt) {
    console.log(`  ⚠ 未知榜单类型: ${rankTypeId}`);
    return null;
  }

  const url = `${BASE_URL}?orderstr=${rankTypeId}&t=${channelId}`;
  const chLabel = channelId === "0" ? "全站" : `频道${channelId}`;
  console.log(`\n→ 采集 晋江${rt.label}（${chLabel}）...`);
  console.log(`  URL: ${url}`);

  let data;
  try {
    ab(port, "open", url);
    sleep(4000);

    data = extractRankData(port, LIMIT);
    if (!data?.channels?.length) {
      console.error(`[jjwxc] 采集失败：页面结构可能已变（选择器没匹配到数据），请检查榜单URL或更新选择器 (${url})`);
      return null;
    }
  } catch (err) {
    console.error(`[jjwxc] ${rt.label} 页面加载或提取出错: ${err.message}`);
    return null;
  }

  let totalBooks = 0;
  let completeBooks = 0;
  data.channels.forEach((ch) => {
    totalBooks += ch.books.length;
    completeBooks += ch.books.filter((b) => b.words && b.collects && (b.nutrition || b.score)).length;
  });
  console.log(
    `  ✓ 提取 ${data.channels.length} 个频道，共 ${totalBooks} 本`
  );

  const now = new Date().toISOString();
  const lines = [
    `# 晋江 · ${rt.label}`,
    "",
    `- 来源：${url}`,
    `- 抓取时间：${now}`,
    `- 频道数：${data.channels.length}`,
    `- 总条目数：${totalBooks}`,
    `- 每频道上限：${LIMIT}`,
    `- 数据质量：${completeBooks === totalBooks ? "OK" : "存在问题"}`,
    `- 有效详情：${completeBooks} / ${totalBooks}`,
    `- 问题摘要：${completeBooks === totalBooks ? "无" : "部分详情页字段未返回，空值已标记[待补]"}`,
    "",
    "---",
    "",
  ];

  for (const ch of data.channels) {
    try {
      lines.push(`## ${ch.name} — ${ch.books.length} 本`, "");
      for (let i = 0; i < ch.books.length; i++) {
        try {
          const b = ch.books[i];
          lines.push(`### #${i + 1} ${b.title}`);
          const meta = [
            b.author,
            b.genre || ch.name,
            b.status || "[待补]",
            b.words || "[待补]",
            `收藏 ${b.collects || "[待补]"}`,
            `营养液 ${b.nutrition || "[待补]"}`,
            `积分 ${b.score || "[待补]"}`,
          ].join(" · ");
          lines.push(`*${meta}*`);
          if (b.url) lines.push(`[作品页](${b.url})`);
          const description = truncateDescription(b.desc);
          if (description) lines.push("", "**简介**", "", description);
          if (b.detailError) lines.push(`**详情采集：** [待补] ${b.detailError}`);
          lines.push("");
        } catch (bookErr) {
          console.error(`[jjwxc] ${rt.label} ${ch.name} 第${i + 1}条处理出错: ${bookErr.message}`);
          lines.push("");
        }
      }
      lines.push("---", "");
    } catch (chErr) {
      console.error(`[jjwxc] ${rt.label} 频道「${ch.name}」处理出错，跳过: ${chErr.message}`);
    }
  }

  const books = data.channels.flatMap((ch) => ch.books.map((b, index) => ({
    id: (b.url && new URL(b.url).searchParams.get("novelid")) || `${rankTypeId}-${ch.name}-${index + 1}`,
    rank: index + 1,
    title: b.title || "",
    author: b.author || "",
    category: ch.name || "",
    subcategory: b.genre || "",
    wordCount: b.words || "",
    metric: [b.collects ? `收藏 ${b.collects}` : "", b.score ? `积分 ${b.score}` : ""].filter(Boolean).join(" · "),
    description: truncateDescription(b.desc),
    url: b.url || url,
    status: b.status || "",
  })));

  return {
    content: lines.join("\n"),
    result: {
      platform: "jjwxc",
      platformLabel: "晋江文学城",
      rankingType: rankTypeId,
      rankingLabel: rt.label,
      sourceUrl: url,
      fetchedAt: Date.now(),
      books,
    },
  };
}

function main() {
  const rankTypes =
    RANKTYPE === "all" ? RANK_TYPES.map((r) => r.id) : [RANKTYPE];
  const channels = [CHANNEL]; // 晋江频道 ID 需从页面获取，默认全站
  const jsonResults = [];

  for (const rt of rankTypes) {
    for (const ch of channels) {
      const output = scrapeRank(PORT, rt, ch);
      if (!output) continue;

      const rtInfo = RANK_TYPES.find((r) => r.id === rt);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const chLabel = ch === "0" ? "全站" : `频道${ch}`;
      const filename = `晋江${rtInfo.label}_${chLabel}_${date}.md`;
      fs.mkdirSync(OUTDIR, { recursive: true });
      const filepath = path.join(OUTDIR, filename);
      fs.writeFileSync(filepath, output.content, "utf-8");
      console.log(`  ✓ 已保存: ${filepath}`);
      jsonResults.push(output.result);
    }
  }

  if (JSON_OUTPUT) {
    if (!jsonResults.length) throw new Error("没有生成有效榜单数据");
    fs.mkdirSync(path.dirname(JSON_OUTPUT), { recursive: true });
    fs.writeFileSync(JSON_OUTPUT, JSON.stringify(jsonResults.length === 1 ? jsonResults[0] : jsonResults), "utf-8");
  }
}

try {
  main();
} catch (e) {
  console.error(`晋江采集失败: ${e && e.message ? e.message : e}`);
  process.exit(1);
}
