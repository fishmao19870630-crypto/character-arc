import { ProxyAgent } from 'undici'
import { isIP } from 'node:net'

const proxyAgents = new Map<string, ProxyAgent>()

export function normalizeProxyUrl(rawProxyUrl?: string): string {
  const trimmed = rawProxyUrl?.trim() || ''
  if (!trimmed) return ''

  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('代理地址格式无效，请填写类似 http://127.0.0.1:7890 的地址。')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('当前仅支持 HTTP/HTTPS 代理；Clash 请使用 HTTP 或 Mixed 端口。')
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error('代理地址必须包含主机和端口，例如 http://127.0.0.1:7890。')
  }

  return parsed.toString()
}

export function createProxyFetch(rawProxyUrl?: string): typeof fetch {
  const proxyUrl = normalizeProxyUrl(rawProxyUrl)
  if (!proxyUrl) return globalThis.fetch

  let dispatcher = proxyAgents.get(proxyUrl)
  if (!dispatcher) {
    dispatcher = new ProxyAgent(proxyUrl)
    proxyAgents.set(proxyUrl, dispatcher)
  }

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const proxyInit = { ...init, dispatcher } as RequestInit
    return globalThis.fetch(input, proxyInit)
  }) as typeof fetch
}

export async function closeProxyConnections(): Promise<void> {
  const agents = [...proxyAgents.values()]
  proxyAgents.clear()
  await Promise.all(agents.map((agent) => agent.close()))
}

export async function testProxyConnection(rawProxyUrl: string): Promise<{ ip: string }> {
  const proxyUrl = normalizeProxyUrl(rawProxyUrl)
  if (!proxyUrl) {
    throw new Error('请先填写代理地址。')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await createProxyFetch(proxyUrl)('https://api.ipify.org?format=json', {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`代理出口 IP 查询失败：HTTP ${response.status}`)
    }
    const payload = await response.json() as { ip?: unknown }
    const ip = typeof payload.ip === 'string' ? payload.ip.trim() : ''
    if (!isIP(ip)) {
      throw new Error('代理已连接，但出口服务没有返回有效 IP 地址。')
    }
    return { ip }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('代理连接测试超时，请确认代理服务正在运行且端口正确。')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
