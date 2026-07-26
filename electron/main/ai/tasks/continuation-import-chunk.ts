import type { AiTaskResult, ContinuationImportChunkResult } from '../shared-types'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject, jsonStringField } from './base'

const handler: TaskHandler = {
  name: 'continuation-import-chunk',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'analysis', 'characters', 'outline'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    return {
      system: `${capabilityPreamble.system}\n\n你是小说续写导入分析器。只返回 JSON，不要补写、改写或评价原文。所有结论必须来自输入章节。`,
      user: `${capabilityPreamble.user}\n\n分析以下章节批次：\n${JSON.stringify(context.chapters ?? [])}\n\n每章输出：chapterId、title、80-150字 summary、出现的重要 characters、尚未解决的 hooks。characters 中 name 是原文姓名，role 是该章能确认的身份或作用，不确定时留空。不要虚构。\n\n返回格式：{"entries":[{"chapterId":"","title":"","summary":"","characters":[{"name":"","role":""}],"hooks":[""]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.map((value) => {
          const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {}
          return {
            chapterId: jsonStringField(entry.chapterId),
            title: jsonStringField(entry.title),
            summary: jsonStringField(entry.summary),
            characters: Array.isArray(entry.characters)
              ? entry.characters.map((characterValue) => {
                  const character = characterValue && typeof characterValue === 'object'
                    ? characterValue as Record<string, unknown>
                    : {}
                  return { name: jsonStringField(character.name), role: jsonStringField(character.role) }
                }).filter((character) => character.name)
              : [],
            hooks: Array.isArray(entry.hooks)
              ? entry.hooks.map((hook) => jsonStringField(hook)).filter(Boolean).slice(0, 8)
              : []
          }
        }).filter((entry) => entry.chapterId && entry.summary)
      : []
    return { entries } as ContinuationImportChunkResult
  },
  validate(result: AiTaskResult): boolean {
    return (result as ContinuationImportChunkResult).entries.length > 0
  },
  resolveMaxTokens(): number {
    return 4000
  }
}

export default handler
