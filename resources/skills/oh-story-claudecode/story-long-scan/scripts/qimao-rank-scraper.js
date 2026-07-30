#!/usr/bin/env node
/**
 * 七猫小说排行榜采集脚本
 *
 * 配合 browser-cdp skill 使用。先启动 Chrome CDP 环境，再运行本脚本。
 * 采集策略：tab 切换男生榜/女生榜和榜单类型，滚动加载后从页面文本解析结构化数据。
 * 输出 Markdown 格式匹配 scan-output-format.md 规范。
 *
 * 用法：
 *   node qimao-rank-scraper.js --channel male --type hot       # 男生大热榜
 *   node qimao-rank-scraper.js --channel female --type new      # 女生新书榜
 *   node qimao-rank-scraper.js --channel all --type all         # 全部采集
 *
 * 前置：
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSON, safeStr, scrollLoad, getArg } = require("./cdp-utils");

const RANK_URL = "https://www.qimao.com/paihang";

const CHANNELS = [
  { id: "male", label: "男频", tab: "男生榜" },
  { id: "female", label: "女频", tab: "女生榜" },
];

const RANK_TYPES = [
  { id: "hot", label: "大热榜" },
  { id: "new", label: "新书榜" },
  { id: "finish", label: "完结榜" },
  { id: "collect", label: "收藏榜" },
  { id: "update", label: "更新榜" },
];

// ---------------------------------------------------------------------------
// 页面操作
// ---------------------------------------------------------------------------

/** 点击包含指定文本的 tab 元素 */
function clickTab(port, text) {
  const js =
    "JSON.stringify((()=>{" +
    "var all=document.querySelectorAll('div,span,a,button,li');" +
    "var el=Array.from(all).find(function(e){" +
    "var t=e.textContent.replace(/\\s+/g,'').trim();" +
    "return t===" + safeStr(text) +
    "});" +
    "if(el){el.click();return true}return false" +
    "})())";
  return evalJSON(port, js);
}

function truncateDescription(text, max = 100) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const end = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"));
  return `${head.slice(0, end >= max / 2 ? end + 1 : max)}...`;
}

/** 从 DOM 获取书籍链接（按页面顺序，去重） */
function extractBookUrls(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var seen=new Set();var urls=[];" +
    "Array.from(document.querySelectorAll('a.s-book-title[href*=\"/shuku/\"]')).forEach(function(a){" +
    "var h=a.getAttribute('href')||a.href||'';" +
    "var m=h.match(/\\/(?:shuku|book)\\/(\\d+)/);" +
    "var title=(a.getAttribute('title')||a.textContent||'').trim();" +
    "if(m&&title&&!seen.has(m[1])){seen.add(m[1]);urls.push({bookId:m[1],title:title,url:new URL(a.getAttribute('href'),location.href).href})}" +
    "});return urls" +
    "})())";
  return evalJSON(port, js) || [];
}

/**
 * 从页面 innerText 解析结构化书籍数据。
 * 七猫页面文本结构固定：排名→书名→作者→题材→子分类→状态→字数→简介→更新→热度
 */
function extractBooksFromText(port) {
  const js =
    "JSON.stringify((()=>{" +
    "var text=document.body.innerText||'';" +
    // 找到榜单数据起始位置
    "var start=-1;" +
    "['日榜','月榜'].forEach(function(m){if(start<0)start=text.indexOf(m)});" +
    "if(start<0)return[];" +
    "var lines=text.substring(start).split(/\\n/);" +
    "var books=[];var cur=null;var fieldIdx=0;" +
    "for(var i=0;i<lines.length;i++){" +
    "  var line=lines[i].trim();" +
    "  if(!line)continue;" +
    // 排名标记：独立数字 1-99
    "  if(/^\\d{1,2}$/.test(line)&&parseInt(line)<100){" +
    "    var rank=parseInt(line);" +
    "    if(cur&&rank!==cur.rank+1)break;" +
    "    if(cur&&cur.title)books.push(cur);" +
    "    cur={rank:rank,title:'',author:'',genre:'',subGenre:'',status:'',words:'',heat:'',update:'',desc:''};" +
    "    fieldIdx=0;continue" +
    "  }" +
    "  if(!cur)continue;" +
    // 跳过 UI 文字
    "  if(/^(加入书架|立即阅读|蝉联|榜首)/.test(line))continue;" +
    // 热度
    "  var hm=line.match(/([\\d.]+)\\s*万\\s*热度/);" +
    "  if(hm){cur.heat=hm[1]+'万';continue}" +
    // 最新更新
    "  if(line.indexOf('最近更新')===0){cur.update=line.replace(/^最近更新\\s*/,'');continue}" +
    // 状态
    "  if(/^(连载中|已完结)$/.test(line)){cur.status=line;continue}" +
    // 字数
    "  if(/^[\\d.]+万字$/.test(line)){cur.words=line;continue}" +
    // 按序填充：书名→作者→题材→子分类
    "  if(fieldIdx===0){cur.title=line;fieldIdx=1;continue}" +
    "  if(fieldIdx===1){cur.author=line;fieldIdx=2;continue}" +
    "  if(fieldIdx===2){cur.genre=line;fieldIdx=3;continue}" +
    "  if(fieldIdx===3){cur.subGenre=line;fieldIdx=4;continue}" +
    // 其余为简介
    "  cur.desc+=(cur.desc?' ':'')+line" +
    "}" +
    "if(cur&&cur.title)books.push(cur);" +
    "return books" +
    "})())";
  return evalJSON(port, js) || [];
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const PORT = parseInt(getArg(args, "--port") || "9222", 10);
const OUTDIR = getArg(args, "--outdir") || ".";
const JSON_OUTPUT = getArg(args, "--json-output");
const CHANNEL = getArg(args, "--channel") || "male";
const RANKTYPE = getArg(args, "--type") || "hot";

function scrapeRank(port, channelId, rankTypeId) {
  const ch = CHANNELS.find((c) => c.id === channelId);
  const rt = RANK_TYPES.find((r) => r.id === rankTypeId);
  if (!ch || !rt) {
    console.log("  ⚠ 未知频道或榜单类型");
    return null;
  }

  console.log(`\n→ 采集 七猫${ch.label}${rt.label}...`);

  let books, urls;
  try {
    ab(port, "open", RANK_URL);
    sleep(3000);

    // 切换频道 tab
    if (!clickTab(port, ch.tab)) {
      console.log(`  ⚠ 未找到「${ch.tab}」tab`);
      return null;
    }
    console.log(`  ✓ 切换到${ch.tab}`);
    sleep(2000);

    // 切换榜单类型 tab
    if (!clickTab(port, rt.label)) {
      console.log(`  ⚠ 未找到「${rt.label}」tab`);
      return null;
    }
    console.log(`  ✓ 切换到${rt.label}`);
    sleep(2000);

    // 滚动加载更多
    scrollLoad(port, 5);
    sleep(1000);

    // 文本解析获取书籍数据 + DOM 获取链接
    books = extractBooksFromText(port);
    urls = extractBookUrls(port);
  } catch (err) {
    console.error(`[qimao] ${ch.label}${rt.label} 页面加载或提取出错: ${err.message}`);
    return null;
  }

  if (!books.length) {
    console.error(`[qimao] 采集失败：页面结构可能已变（选择器没匹配到数据），请检查榜单URL或更新选择器 (${RANK_URL} ${ch.label}${rt.label})`);
    return null;
  }

  // 按标题匹配 URL
  for (const b of books) {
    try {
      const matched = urls.find((u) => u.title === b.title);
      if (matched) b.url = matched.url;
    } catch (matchErr) {
      console.error(`[qimao] URL匹配出错（#${b.rank} ${b.title}）: ${matchErr.message}`);
    }
  }

  console.log(`  ✓ 提取 ${books.length} 本`);

  const now = new Date().toISOString();
  const validBooks = books.filter((book) => book.rank && book.title && book.author && book.heat).length;
  const lines = [
    `# 七猫 · ${ch.label} · ${rt.label}`,
    "",
    `- 来源：${RANK_URL}`,
    `- 抓取时间：${now}`,
    `- 条目数：${books.length}`,
    `- 数据质量：${validBooks === books.length ? "OK" : "存在问题"}`,
    `- 有效条目：${validBooks} / ${books.length}`,
    `- 问题摘要：${validBooks === books.length ? "无" : "部分必填字段缺失，空值已标记[待补]"}`,
    "",
    "---",
    "",
  ];

  for (const b of books) {
    try {
      lines.push(`### #${b.rank} ${b.title}`);
      const meta = [
        b.author,
        b.genre,
        b.subGenre,
        b.status,
        b.words,
        b.heat ? b.heat + "热度" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      lines.push(`*${meta}*`);
      if (b.update) lines.push(`**最新更新：** ${b.update}`);
      if (b.url) lines.push(`[作品页](${b.url})`);
      const description = truncateDescription(b.desc);
      if (description) {
        lines.push("");
        lines.push("**简介**");
        lines.push("");
        lines.push(description);
      }
      lines.push("", "---", "");
    } catch (bookErr) {
      console.error(`[qimao] ${ch.label}${rt.label} 第${b.rank}条处理出错: ${bookErr.message}`);
      lines.push("", "---", "");
    }
  }

  return {
    content: lines.join("\n"),
    result: {
      platform: "qimao",
      platformLabel: "七猫小说",
      rankingType: `${channelId}:${rankTypeId}`,
      rankingLabel: `${ch.label}${rt.label}`,
      sourceUrl: RANK_URL,
      fetchedAt: Date.now(),
      books: books.map((b, index) => ({
        id: (b.url && b.url.match(/\/(?:shuku|book)\/(\d+)/)?.[1]) || `${channelId}-${rankTypeId}-${index + 1}`,
        rank: b.rank || index + 1,
        title: b.title || "",
        author: b.author || "",
        category: b.genre || "",
        subcategory: b.subGenre || "",
        wordCount: b.words || "",
        metric: b.heat ? `${b.heat}热度` : "",
        description: truncateDescription(b.desc),
        url: b.url || RANK_URL,
        status: b.status || "",
      })),
    },
  };
}

function main() {
  const channels = CHANNEL === "all" ? CHANNELS.map((c) => c.id) : [CHANNEL];
  const rankTypes = RANKTYPE === "all" ? RANK_TYPES.map((r) => r.id) : [RANKTYPE];
  const jsonResults = [];

  for (const ch of channels) {
    for (const rt of rankTypes) {
      const output = scrapeRank(PORT, ch, rt);
      if (!output) continue;

      const chInfo = CHANNELS.find((c) => c.id === ch);
      const rtInfo = RANK_TYPES.find((r) => r.id === rt);
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const filename = `七猫${chInfo.label}${rtInfo.label}_${date}.md`;
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
  console.error(`七猫采集失败: ${e && e.message ? e.message : e}`);
  process.exit(1);
}
