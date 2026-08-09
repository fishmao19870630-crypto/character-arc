/** 从错误响应体中提取可读的错误信息 */
async function readErrorMessage(response: Response, fallbackLabel: string): Promise<string> {
  const fallback = `${fallbackLabel} 请求失败：${response.status} ${response.statusText}`
  try {
    const data = (await response.json()) as Record<string, unknown>
    const error = (data.error ?? data) as Record<string, unknown>
    const message =
      (typeof error.message === 'string' && error.message) ||
      (typeof error.error === 'string' && error.error) ||
      (typeof data.message === 'string' && data.message)
    return message ? `${fallbackLabel} 请求失败：${message}` : fallback
  } catch {
    return fallback
  }
}

export interface PerformAiRequestOptions {
  url: string
  init: RequestInit
  providerLabel: string
  externalSignal?: AbortSignal
  timeoutMs?: number
  requestFetch?: typeof fetch
}

async function performAiRequest(
  urlOrOpts: string | PerformAiRequestOptions,
  init?: RequestInit,
  providerLabel?: string,
  externalSignal?: AbortSignal
): Promise<Response> {
  let url: string
  let reqInit: RequestInit
  let label: string
  let signal: AbortSignal | undefined
  let timeoutMs: number | undefined
  let requestFetch: typeof fetch

  if (typeof urlOrOpts === 'object') {
    url = urlOrOpts.url
    reqInit = urlOrOpts.init
    label = urlOrOpts.providerLabel
    signal = urlOrOpts.externalSignal
    timeoutMs = urlOrOpts.timeoutMs
    requestFetch = urlOrOpts.requestFetch ?? globalThis.fetch
  } else {
    url = urlOrOpts
    reqInit = init!
    label = providerLabel!
    signal = externalSignal
    timeoutMs = undefined
    requestFetch = globalThis.fetch
  }

  const timeoutCtl = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined
  const timer = timeoutCtl ? setTimeout(() => timeoutCtl.abort(), timeoutMs) : undefined
  const combinedSignal = timeoutCtl
    ? signal
      ? AbortSignal.any([signal, timeoutCtl.signal])
      : timeoutCtl.signal
    : signal
  try {
    const response = await requestFetch(url, { ...reqInit, signal: combinedSignal })
    if (!response.ok) {
      throw new Error(await readErrorMessage(response, label))
    }
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw error
      if (timeoutCtl?.signal.aborted) {
        throw new Error(`${label} 请求超时，请检查网络、代理或模型服务状态。`)
      }
    }
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export { performAiRequest, readErrorMessage }
