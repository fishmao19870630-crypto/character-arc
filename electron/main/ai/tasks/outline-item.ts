import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject, jsonStringField } from './base'
import type { AiTaskResult, OutlineResult } from '../shared-types'
import { formatStoryStateConstraint, resolveWritingStyleInstruction } from '../prompts/shared'

/**
 * 将原始大纲数据标准化为规范的 OutlineResult 格式
 * @param parsed - 原始大纲数据
 * @returns 标准化后的大纲结果
 */
export function normalizeOutline(parsed: Partial<OutlineResult>): OutlineResult {
  return {
    title: jsonStringField(parsed.title, '第1章：新剧情节点'),
    wordTarget: normalizeOutlineWordTarget(parsed.wordTarget),
    conflict: jsonStringField(parsed.conflict, '新的冲突正在酝酿。'),
    summary: jsonStringField(parsed.summary, 'AI 未返回有效剧情摘要'),
    relatedCharacterIds: normalizeOutlineReferenceIds(parsed.relatedCharacterIds),
    relatedOrganizationIds: normalizeOutlineReferenceIds(parsed.relatedOrganizationIds),
    relatedWorldviewIds: normalizeOutlineReferenceIds(parsed.relatedWorldviewIds)
  }
}

/** 清洗模型返回的关联 ID，避免空值、重复值和异常长数组进入工作区。 */
export function normalizeOutlineReferenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
      const record = item as Record<string, unknown>
      return jsonStringField(record.id ?? record.name ?? record.title)
    })
    .filter(Boolean))].slice(0, 12)
}

/** 大纲节点统一使用 3000-4000 字的章节预算，避免模型返回分卷级目标或无效值。 */
export function normalizeOutlineWordTarget(value: unknown): string {
  const raw = jsonStringField(value)
  const wanMatch = raw.match(/(\d+(?:\.\d+)?)\s*万/)
  const thousandMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:千|[kK])/)
  const numericMatch = raw.match(/\d+(?:\.\d+)?/)
  const numeric = wanMatch
    ? Number(wanMatch[1]) * 10000
    : thousandMatch
      ? Number(thousandMatch[1]) * 1000
      : numericMatch
        ? Number(numericMatch[0])
        : 3000
  return String(Math.min(4000, Math.max(3000, Math.round(numeric))))
}

/** 单条大纲生成任务：为当前章节之后补充一个新的大纲节点 */
const handler: TaskHandler = {
  name: 'outline-item',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'relations', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const relationPrompt = `\n\n关联绑定要求：从角色、组织、世界观参考对象中读取真实 id；只填写本节点直接涉及的 id，分别放入 relatedCharacterIds、relatedOrganizationIds、relatedWorldviewIds，没有关联时返回空数组。`
    return {
      system: `${capabilityPreamble.system}\n\n你是小说剧情大纲助手。请只返回 JSON 对象，不要返回 Markdown。字段必须包含 title、wordTarget、conflict、summary、relatedCharacterIds、relatedOrganizationIds、relatedWorldviewIds。关联字段只能填写上下文中已有实体的 id；角色参考非空时，relatedCharacterIds 至少填写一个直接相关角色的 id。${formatStoryStateConstraint(context)}`,
      user: `${capabilityPreamble.user}\n\n基于以下上下文，为当前小说项目补充一个新的章节大纲节点。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前分卷：${String(context.chapterVolumeTitle ?? '')}\n当前分卷摘要：${String(context.chapterVolumeSummary ?? '')}\n当前章节标题：${String(context.chapterTitle ?? '')}\n当前章节摘要：${String(context.chapterSummary ?? '')}\n当前章节预估字数：${String(context.chapterWordTarget ?? '')}\n当前章节正文：\n${String(context.chapterContent ?? '')}\n已有大纲：${JSON.stringify(context.outlineTitles ?? [])}\n当前分卷已有节点：${JSON.stringify(context.currentVolumeOutlineItems ?? [])}\n世界观关键词：${JSON.stringify(context.worldviewTitles ?? [])}\n角色参考：${JSON.stringify(context.characters ?? [])}\n组织参考：${JSON.stringify(context.organizations ?? [])}\n世界观参考：${JSON.stringify(context.worldviewEntries ?? [])}\n角色关系参考：${JSON.stringify(context.characterRelationships ?? [])}\n组织归属参考：${JSON.stringify(context.organizationMemberships ?? [])}\n补充要求：${String(context.userPrompt ?? '')}\n\n要求：\n1. title 为新的章节标题，并体现与当前章节的承接关系\n2. wordTarget 使用 3000 到 4000 之间的纯数字\n3. conflict 用一句话概括下一章的核心冲突\n4. summary 用中文描述剧情推进，80 到 180 字\n5. 与当前分卷目标、已有大纲和当前章节情绪保持连续\n6. 角色行动必须符合角色定位、既有关系和组织立场；涉及世界规则时不得与已有设定冲突\n7. ${writingStyle}\n\n返回格式：{"title":"","wordTarget":"","conflict":"","summary":"","relatedCharacterIds":[],"relatedOrganizationIds":[],"relatedWorldviewIds":[]}` + relationPrompt
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeOutline(extractJsonObject(raw) as Partial<OutlineResult>)
  },
  validate(result: AiTaskResult): boolean {
    const r = result as OutlineResult
    return Boolean(r.title?.trim() && r.summary?.trim())
  }
}
export default handler
