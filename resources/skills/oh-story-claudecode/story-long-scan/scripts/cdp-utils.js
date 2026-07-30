/**
 * CDP 工具函数 — 各平台采集脚本的公共依赖
 *
 * 使用方式：
 *   const { ab, sleep, evalJSON, scrollLoad, getArg, safeStr } = require("./cdp-utils");
 *
 * 前置：
 *   node {SKILL_DIR}/browser-cdp/scripts/setup-cdp-chrome.js 9222
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function resolveAgentBrowser() {
  if (process.env.AGENT_BROWSER_BIN) return process.env.AGENT_BROWSER_BIN;
  if (process.platform !== "win32") return "agent-browser";

  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidates = [
      path.join(dir, "agent-browser.exe"),
      path.join(dir, "node_modules", "agent-browser", "bin", `agent-browser-win32-${arch}.exe`),
      path.join(dir, "..", "agent-browser", "bin", `agent-browser-win32-${arch}.exe`),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
  }

  throw new Error("未找到 agent-browser 原生可执行文件，请先运行 npm install -g agent-browser");
}

const AGENT_BROWSER = resolveAgentBrowser();

// ---------------------------------------------------------------------------
// agent-browser 工具函数
// ---------------------------------------------------------------------------

/**
 * 调用 agent-browser CLI
 * @param {number} port - CDP 端口
 * @param  {...string} args - agent-browser 参数
 * @returns {string} stdout（trim 后）
 */
function ab(port, ...args) {
  try {
    return execFileSync(
      AGENT_BROWSER,
      ["--cdp", String(port), ...args],
      {
        encoding: "utf-8",
        timeout: Number(process.env.AGENT_BROWSER_TIMEOUT_MS) || 120000,
        stdio: ["pipe", "pipe", "pipe"],
      }
    ).trim();
  } catch (e) {
    const stdout = e.stdout?.trim();
    if (stdout) return stdout;
    const stderr = e.stderr?.trim();
    throw new Error(stderr || e.message);
  }
}

/** 等待 ms 毫秒（跨平台，不依赖系统 sleep 命令） */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 在浏览器内执行 JS 并解析 JSON 返回值 */
function evalJSON(port, js) {
  const raw = ab(port, "eval", js);
  if (!raw || raw === "ERR") return null;
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch {}
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 安全地将值插入浏览器 eval 字符串。
 * 使用 JSON.stringify 确保值不会因特殊字符（引号、反斜杠等）破坏 eval 字符串。
 * @param {*} val - 要插入的值
 * @returns {string} JSON 字符串表示（含引号）
 */
function safeStr(val) {
  return JSON.stringify(String(val));
}

/**
 * 滚动页面加载更多内容
 * @param {number} port - CDP 端口
 * @param {number} times - 滚动次数
 * @param {number} [interval=1000] - 每次滚动间隔（ms）
 */
function scrollLoad(port, times, interval = 1000) {
  for (let i = 0; i < times; i++) {
    ab(port, "eval", "window.scrollBy(0, window.innerHeight)");
    sleep(interval);
  }
}

/** 解析 --xxx 参数 */
function getArg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

module.exports = { ab, sleep, evalJSON, safeStr, scrollLoad, getArg };
