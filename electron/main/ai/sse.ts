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
  constructor(timeoutMs: number) {
    super(`AI 流式响应已连续 ${Math.round(timeoutMs / 1000)} 秒没有新数据。`)
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
