export function splitCompleteSseEvents(buffer: string): {
  events: string[]
  remainder: string
} {
  const events: string[] = []
  let remainder = buffer
  let delimiter: RegExpMatchArray | null

  while ((delimiter = remainder.match(/\r?\n\r?\n/)) !== null) {
    const end = (delimiter.index ?? 0) + delimiter[0].length
    events.push(remainder.slice(0, end))
    remainder = remainder.slice(end)
  }

  return { events, remainder }
}

export class AiStreamIdleTimeoutError extends Error {
  constructor(timeoutMs: number, phase: 'response-start' | 'stream-idle' = 'stream-idle') {
    super(phase === 'response-start'
      ? `AI 请求等待响应超过 ${Math.round(timeoutMs / 1000)} 秒，请检查网络、代理或接口限流状态。`
      : `AI 流式响应已连续 ${Math.round(timeoutMs / 1000)} 秒没有新数据。`)
    this.name = 'AiStreamIdleTimeoutError'
  }
}

export function isAiStreamIdleTimeoutError(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!(current instanceof Error)) return false
    if (current.name === 'AiStreamIdleTimeoutError') return true
    current = (current as Error & { cause?: unknown }).cause
  }
  return false
}

export function readStreamChunkWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AiStreamIdleTimeoutError(timeoutMs)), timeoutMs)
    reader.read().then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export async function fetchWithResponseStartTimeout(
  requestFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const timeoutController = new AbortController()
  const externalSignal = init?.signal ?? undefined
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort()
      reject(new AiStreamIdleTimeoutError(timeoutMs, 'response-start'))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      requestFetch(input, { ...init, signal }),
      timeoutPromise
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
