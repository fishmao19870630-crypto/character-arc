#!/usr/bin/env node
/**
 * 刺猬猫阅读排行榜采集脚本
 *
 * 配合 browser-cdp skill 使用。先启动 Chrome CDP 环境，再运行本脚本。
 * 采集策略：从 rank-index 榜单 DOM 提取排名、题材、指标和作品链接，
 * 再按作品链接去重并发访问详情页，补齐作者、状态、字数、收藏、点击与简介。
 * 输出 Markdown 格式匹配 scan-output-format.md 规范。
 *
 * 用法：
 *   node ciweimao-rank-scraper.js --type click       # 点击榜
 *   node ciweimao-rank-scraper.js --type monthly      # 月票榜
 *   node ciweimao-rank-scraper.js --type all           # 全部榜单
 *
 * 前置：
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const fs = require("fs");
const path = require("path");
const { ab, sleep, evalJSON, scrollLoad, getArg } = require("./cdp-utils");

const RANK_URL = "https://www.ciweimao.com/rank-index";

const RANK_TYPES = [
  { id: "click", label: "点击榜", header: "点击榜" },
  { id: "favor", label: "收藏榜", header: "收藏榜" },
  { id: "recommend", label: "推荐榜", header: "推荐榜" },
  { id: "subscribe", label: "订阅榜", header: "订阅榜" },
  { id: "monthly", label: "月票榜", header: "月票榜" },
  { id: "tsukkomi", label: "吐槽榜", header: "吐槽榜" },
  { id: "newbook", label: "新书榜", header: "新书榜" },
  { id: "blade", label: "刀片榜", header: "刀片榜" },
  { id: "update", label: "更新榜", header: "更新榜" },
];

// ---------------------------------------------------------------------------
// 页面提取
// ---------------------------------------------------------------------------

/**
 * 从 rank-index 单页解析所有榜单。
 * 页面结构：每个榜单有标题行（如"点击榜"），后跟 NO.1 特殊条目 + #2-10 普通条目。
 * NO.1 格式：标题 / 作者 / 指标值（三行）
 * #2-10 格式：N[题材]书名 / 指标值（两行）
 */
function extractAllRanks(port) {
  const js = `(async()=>{
    const clean=(value)=>String(value||'').replace(/\\s+/g,' ').trim();
    const headers=new Set(['点击榜','收藏榜','推荐榜','订阅榜','月票榜','吐槽榜','新书榜','刀片榜','更新榜']);
    const sections=[];
    for(const heading of document.querySelectorAll('.rank-bd h3.title')){
      const name=clean(heading.textContent);
      if(!headers.has(name))continue;
      const box=heading.closest('.recommend-box');
      const list=box?.querySelector('ul.tab');
      if(!list)continue;
      const entries=[];
      for(const item of list.querySelectorAll(':scope > li')){
        const top=item.classList.contains('top1');
        const link=top ? item.querySelector('.info h3 a[href*="/book/"]') : item.querySelector(':scope > a[href*="/book/"]');
        if(!link)continue;
        const rankText=clean(item.querySelector('.icon-top')?.textContent).replace(/\\D/g,'');
        const metric=clean(item.querySelector(top ? '.info .num span' : 'span.num')?.textContent);
        entries.push({
          rank:Number(rankText)||entries.length+1,
          title:clean(link.getAttribute('title')||link.textContent),
          author:top ? clean(item.querySelector('.author')?.textContent) : '',
          genre:clean(item.querySelector('b')?.textContent).replace(/^\\[|\\]$/g,''),
          metric,
          url:new URL(link.getAttribute('href'),location.href).href
        });
      }
      if(entries.length)sections.push({name,entries});
    }

    const byUrl=new Map();
    for(const entry of sections.flatMap((section)=>section.entries)){
      if(!byUrl.has(entry.url))byUrl.set(entry.url,[]);
      byUrl.get(entry.url).push(entry);
    }
    const urls=Array.from(byUrl.keys());
    let cursor=0;
    async function worker(){
      while(cursor<urls.length){
        const url=urls[cursor++];
        try{
          const response=await fetch(url,{credentials:'include'});
          if(!response.ok)throw new Error('HTTP '+response.status);
          const doc=new DOMParser().parseFromString(await response.text(),'text/html');
          const text=(selector)=>clean(doc.querySelector(selector)?.textContent);
          const grade=Array.from(doc.querySelectorAll('.book-grade b')).map((node)=>clean(node.textContent));
          const breadcrumbLinks=Array.from(doc.querySelectorAll('.breadcrumb a'));
          const detail={
            author:text('.author-info h3'),
            genre:clean(breadcrumbLinks.at(-1)?.textContent),
            status:text('.update-state'),
            totalClick:grade[0]||'',
            collects:grade[1]||'',
            words:grade[2]||'',
            desc:text('.book-desc')
          };
          for(const entry of byUrl.get(url))Object.assign(entry,detail);
        }catch(error){
          for(const entry of byUrl.get(url))entry.detailError=String(error?.message||error);
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(8,urls.length)},worker));
    return JSON.stringify(sections);
  })()`;
  return evalJSON(port, js) || [];
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
const RANKTYPE = getArg(args, "--type") || "all";

function main() {
  console.log("\n→ 采集 刺猬猫排行榜...");
  console.log(`  URL: ${RANK_URL}`);

  let sections;
  try {
    ab(PORT, "open", RANK_URL);
    sleep(4000);
    scrollLoad(PORT, 3);
    sleep(1000);

    sections = extractAllRanks(PORT);
    if (!sections.length) {
      console.error("[ciweimao] 采集失败：页面结构可能已变（选择器没匹配到数据），请检查榜单URL或更新选择器");
      return;
    }

  } catch (err) {
    console.error(`[ciweimao] 采集失败（页面加载或提取阶段）: ${err.message}`);
    return;
  }

  const allEntries = sections.flatMap((section) => section.entries);
  const uniqueUrls = new Set(allEntries.map((entry) => entry.url));
  console.log(`  ✓ 提取 ${sections.length} 个榜单，${uniqueUrls.size} 本唯一作品`);

  // 筛选需要的榜单类型
  const targetTypes =
    RANKTYPE === "all"
      ? RANK_TYPES
      : RANK_TYPES.filter((r) => r.id === RANKTYPE);
  const jsonResults = [];

  for (const rt of targetTypes) {
    try {
      const section = sections.find((s) => s.name === rt.header);
      if (!section || !section.entries.length) {
        console.log(`  ⚠ ${rt.label} 无数据，跳过`);
        continue;
      }

      const now = new Date().toISOString();
      const complete = section.entries.filter((entry) => entry.author && entry.words).length;
      const lines = [
        `# 刺猬猫 · ${rt.label}`,
        "",
        `- 来源：${RANK_URL}`,
        `- 抓取时间：${now}`,
        `- 条目数：${section.entries.length}`,
        `- 数据质量：${complete === section.entries.length ? "OK" : "存在问题"}`,
        `- 有效详情：${complete} / ${section.entries.length}`,
        `- 问题摘要：${complete === section.entries.length ? "无" : "部分详情页字段未返回，空值已标记[待补]"}`,
        "",
        "---",
        "",
      ];

      for (const entry of section.entries) {
        try {
          lines.push(`### #${entry.rank} ${entry.title}`);
          const meta = [
            entry.author || "[待补]",
            entry.genre || "[待补]",
            entry.status || "[待补]",
            entry.words ? `${entry.words}字` : "[待补]",
            entry.metric ? `榜单指标 ${entry.metric}` : "",
            entry.totalClick ? `总点击 ${entry.totalClick}` : "",
            entry.collects ? `总收藏 ${entry.collects}` : "",
          ].filter(Boolean).join(" · ");
          if (meta) lines.push(`*${meta}*`);

          if (entry.url) lines.push(`[作品页](${entry.url})`);
          const description = truncateDescription(entry.desc);
          if (description) lines.push("", "**简介**", "", description);
          if (entry.detailError) lines.push(`**详情采集：** [待补] ${entry.detailError}`);

          lines.push("", "---", "");
        } catch (entryErr) {
          console.error(`[ciweimao] ${rt.label} 条目处理出错（#${entry.rank} ${entry.title}）: ${entryErr.message}`);
          lines.push("", "---", "");
        }
      }

      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const filename = `刺猬猫${rt.label}_${date}.md`;
      fs.mkdirSync(OUTDIR, { recursive: true });
      const filepath = path.join(OUTDIR, filename);
      fs.writeFileSync(filepath, lines.join("\n"), "utf-8");
      console.log(`  ✓ ${rt.label}：${section.entries.length} 条 → ${filepath}`);
      jsonResults.push({
        platform: "ciweimao",
        platformLabel: "刺猬猫",
        rankingType: rt.id,
        rankingLabel: rt.label,
        sourceUrl: RANK_URL,
        fetchedAt: Date.now(),
        books: section.entries.map((entry, index) => ({
          id: (entry.url && entry.url.match(/\/book\/(\d+)/)?.[1]) || `${rt.id}-${index + 1}`,
          rank: entry.rank || index + 1,
          title: entry.title || "",
          author: entry.author || "",
          category: entry.genre || "",
          subcategory: "",
          wordCount: entry.words ? `${entry.words}字` : "",
          metric: entry.metric || "",
          description: truncateDescription(entry.desc),
          url: entry.url || RANK_URL,
          status: entry.status || "",
        })),
      });
    } catch (rankErr) {
      console.error(`[ciweimao] ${rt.label} 处理出错，跳过: ${rankErr.message}`);
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
  console.error(`刺猬猫采集失败: ${e && e.message ? e.message : e}`);
  process.exit(1);
}
