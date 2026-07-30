import type { AiTaskResult, MarketAnalysisResult } from '../shared-types'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject, jsonStringField } from './base'

function normalizeStringList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, limit)
    : []
}

const handler: TaskHandler = {
  name: 'market-analysis',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'analysis', 'inspiration', 'outline'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const selectedBooks = Array.isArray(context.books) ? context.books.slice(0, 10) : []
    return {
      system: `${capabilityPreamble.system}\n\n你是网络小说市场分析与原创策划助手。只返回 JSON 对象，不返回 Markdown。你可以提炼抽象的题材趋势、读者期待和写作技法，但不得复用参考作品的专有名称、人物关系组合、世界观设定、标志性桥段、情节顺序或原文表达。`,
      user: `${capabilityPreamble.user}\n\n请分析以下公开榜单元数据，并生成可独立创作的新方向。\n\n平台：${String(context.platformLabel ?? '')}\n榜单：${String(context.rankingLabel ?? '')}\n参考作品：\n${JSON.stringify(selectedBooks)}\n\n要求：\n1. summary 用 120 到 220 字概括榜单信号和局限，明确榜单不等于全部市场。\n2. patterns 返回 3 到 5 项，每项包含 label、evidence、writingTechnique。evidence 只能基于给定书名、分类、榜单指标和简介。\n3. originalConcepts 恰好返回 3 个原创方案，每项包含 title、premise、differentiation、targetAudience、outline。\n4. 每个 outline 恰好 5 个阶段，形成“开篇钩子—压力升级—中段转折—终局对抗—阶段收束”。\n5. 三个方案必须在主角身份、核心矛盾和世界规则上彼此不同，并与参考作品保持明显差异。\n6. 不要声称掌握未提供的小说正文，不做逐章或文风模仿。\n\n返回格式：{"summary":"","patterns":[{"label":"","evidence":"","writingTechnique":""}],"originalConcepts":[{"title":"","premise":"","differentiation":"","targetAudience":"","outline":[""]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<MarketAnalysisResult>
    const patterns = Array.isArray(parsed.patterns) ? parsed.patterns.slice(0, 5).map((item) => ({
      label: jsonStringField(item?.label),
      evidence: jsonStringField(item?.evidence),
      writingTechnique: jsonStringField(item?.writingTechnique)
    })) : []
    const originalConcepts = Array.isArray(parsed.originalConcepts) ? parsed.originalConcepts.slice(0, 3).map((item) => ({
      title: jsonStringField(item?.title),
      premise: jsonStringField(item?.premise),
      differentiation: jsonStringField(item?.differentiation),
      targetAudience: jsonStringField(item?.targetAudience),
      outline: normalizeStringList(item?.outline, 5)
    })) : []
    return { summary: jsonStringField(parsed.summary), patterns, originalConcepts } as MarketAnalysisResult
  },
  validate(result: AiTaskResult): boolean {
    const value = result as MarketAnalysisResult
    return Boolean(
      value.summary.trim()
      && value.patterns.length >= 3
      && value.patterns.every((item) => item.label && item.evidence && item.writingTechnique)
      && value.originalConcepts.length === 3
      && value.originalConcepts.every((item) => item.title && item.premise && item.differentiation && item.targetAudience && item.outline.length === 5)
    )
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const value = result as MarketAnalysisResult
    const errors: string[] = []
    if (!value.summary?.trim()) errors.push('summary 不能为空。')
    if (value.patterns?.length < 3) errors.push('patterns 至少返回 3 项。')
    if (value.originalConcepts?.length !== 3) errors.push('originalConcepts 必须恰好返回 3 项。')
    if (value.originalConcepts?.some((item) => item.outline.length !== 5)) errors.push('每个原创方案的 outline 必须恰好 5 项。')
    return errors
  },
  resolveMaxTokens() {
    return 3000
  }
}

export default handler
