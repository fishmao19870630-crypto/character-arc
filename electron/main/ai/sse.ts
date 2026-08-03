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
