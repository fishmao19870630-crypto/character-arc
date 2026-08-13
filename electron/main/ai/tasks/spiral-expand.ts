import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'
import type { SpiralExpandResult, SpiralSeedResult } from '../spiral/types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { resolveProjectBootstrapPromptParts } from '../prompts/bootstrap-strategies'
import { normalizeWorldviewType } from './worldview-type'

function normalizeChapterTitle(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withoutPrefix = raw
    .replace(/^\s*第[^章]{1,12}章\s*[:：、.．-]?\s*/u, '')
    .replace(/^\s*\d+\s*[.．、:：-]\s*/u, '')
  return `第${index + 1}章：${withoutPrefix || '剧情节拍'}`
}

function normalizeChapterWordTarget(value: unknown, novelLength: unknown): string {
  const isShort = novelLength === 'short'
  const minimum = isShort ? 1800 : 3000
  const maximum = isShort ? 2800 : 4000
  const fallback = isShort ? 2000 : 3000
  const matched = String(value ?? '').replace(/,/g, '').match(/\d+/)
  const parsed = matched ? Number(matched[0]) : fallback
  const clamped = Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback))
  return String(Math.round(clamped / 100) * 100)
}

function normalizeStringList(value: unknown, excluded = ''): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item && item !== excluded.trim()))]
}

/** 螺旋展开任务：基于核心骨架展开配角、大纲节拍和补充世界设定 */
const handler: TaskHandler = {
  name: 'spiral-expand',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'outline', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context)
    const wordTargetRange = context.projectNovelLength === 'short' ? '1800 到 2800' : '3000 到 4000'
    const seedResult = context.spiralSeedResult as SpiralSeedResult | undefined
    const seedBlock = seedResult
      ? `主角：${seedResult.protagonist.name}
核心欲望：${seedResult.protagonist.coreDesire}
核心缺陷：${seedResult.protagonist.coreFlaw}
内在矛盾：${seedResult.protagonist.innerConflict}
故事前提：${seedResult.mainArc.premise}
核心问题：${seedResult.mainArc.centralQuestion}
结局方向：${seedResult.mainArc.endingDirection}
已有世界规则：${seedResult.worldRules.map((r) => `${r.title}（${r.type}）：${r.content}`).join('\n')}`
      : '（无第一圈结果）'

    return {
      system: `${capabilityPreamble.system}\n\n你是小说项目展开设计师。基于已确定的核心骨架（主角矛盾+主线方向+世界规则），展开配角、组织关系、大纲节拍和补充设定。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n项目标题：${String(context.projectTitle ?? '')}
项目题材：${genreLabel}
作品长度：${lengthLabel}
小说简介：${String(context.projectPremise ?? '')}

题材与长度策略：
${strategyBlock}

【第一圈已确定的核心骨架】
${seedBlock}

请基于以上核心骨架，展开以下内容：

1. supportingCharacters：4-6个配角，每个包含 name、role（短语定位）、tags（3-5个身份、性格、能力或阵营标签，不能与 role 重复）、relationToProtagonist（与主角的关系和冲突点）、motivation（自身动机，不能只是服务主角）
2. organizations：1-3个与主线直接相关的组织或势力，每个包含 name、type、description、motto，以及 members 数组。members 只能引用主角或 supportingCharacters 中的角色姓名，并包含 characterName、role、notes。
3. relationships：2-4条人物关系，fromCharacter 和 toCharacter 只能引用主角或 supportingCharacters 中的角色姓名；包含 type、description、intensity（0-100）。关系必须体现冲突、合作或情感牵引，不要与角色自我关联。
4. outlineBeats：3-5个开篇章节大纲，每个包含 title、conflict（本章核心冲突）、characterDriven（哪个角色的什么选择驱动了本章）、summary、wordTarget（纯数字）、relatedCharacters、relatedOrganizations、relatedWorldview。三个关联数组分别只能填写本次生成的角色姓名、组织名称、世界规则标题；每章至少关联一个直接参与的角色。title 必须使用“第N章：章节名”格式，从第1章开始连续编号；每章预估字数必须控制在${wordTargetRange}字，不得使用整卷或全书字数。
5. expandedWorldview：1-2条补充世界设定，服务于配角动机或大纲冲突需要

关键原则：
- 配角必须有独立动机，不是主角的工具人
- 每个大纲节拍必须由角色选择驱动，不是外部事件硬推
- 配角的动机要能与主角的欲望/缺陷产生碰撞
- 组织必须拥有独立目标，并能影响至少一名角色的选择
- 关系和组织归属必须与角色设定及大纲冲突保持一致
- 大纲节拍之间要有因果递进，不是并列罗列
- ${writingStyle}

返回格式：{"supportingCharacters":[{"name":"","role":"","tags":[""],"relationToProtagonist":"","motivation":""}],"organizations":[{"name":"","type":"","description":"","motto":"","members":[{"characterName":"","role":"","notes":""}]}],"relationships":[{"fromCharacter":"","toCharacter":"","type":"","description":"","intensity":70}],"outlineBeats":[{"title":"","conflict":"","characterDriven":"","summary":"","wordTarget":"","relatedCharacters":[""],"relatedOrganizations":[""],"relatedWorldview":[""]}],"expandedWorldview":[{"type":"","title":"","content":""}]}`
    }
  },
  normalize(raw: string, context?: Record<string, unknown>): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<SpiralExpandResult>
    const supportingCharacters = Array.isArray(parsed.supportingCharacters)
      ? parsed.supportingCharacters.slice(0, 6).map((c) => ({
          name: c.name?.trim() || '配角',
          role: c.role?.trim() || '待设定',
          tags: normalizeStringList(c.tags, c.role).slice(0, 5),
          relationToProtagonist: c.relationToProtagonist?.trim() || '待设定',
          motivation: c.motivation?.trim() || '待设定'
        }))
      : []
    const organizations = Array.isArray(parsed.organizations)
      ? parsed.organizations.slice(0, 3).map((organization) => ({
          name: organization.name?.trim() || '未命名组织',
          type: organization.type?.trim() || '势力',
          description: organization.description?.trim() || '待补充组织定位。',
          motto: organization.motto?.trim() || '',
          members: Array.isArray(organization.members)
            ? organization.members.slice(0, 8).map((member) => ({
                characterName: member.characterName?.trim() || '',
                role: member.role?.trim() || '成员',
                notes: member.notes?.trim() || ''
              })).filter((member) => member.characterName)
            : []
        }))
      : []
    const relationships = Array.isArray(parsed.relationships)
      ? parsed.relationships.slice(0, 6).map((relationship) => ({
          fromCharacter: relationship.fromCharacter?.trim() || '',
          toCharacter: relationship.toCharacter?.trim() || '',
          type: relationship.type?.trim() || '关系',
          description: relationship.description?.trim() || '待补充关系说明。',
          intensity: Math.min(100, Math.max(0, Number(relationship.intensity) || 50))
        })).filter((relationship) => relationship.fromCharacter && relationship.toCharacter && relationship.fromCharacter !== relationship.toCharacter)
      : []
    const outlineBeats = Array.isArray(parsed.outlineBeats)
      ? parsed.outlineBeats.slice(0, 5).map((b, index) => ({
          title: normalizeChapterTitle(b.title, index),
          conflict: b.conflict?.trim() || '待设定',
          characterDriven: b.characterDriven?.trim() || '待设定',
          summary: b.summary?.trim() || '待设定',
          wordTarget: normalizeChapterWordTarget(b.wordTarget, context?.projectNovelLength),
          relatedCharacters: normalizeStringList(b.relatedCharacters),
          relatedOrganizations: normalizeStringList(b.relatedOrganizations),
          relatedWorldview: normalizeStringList(b.relatedWorldview)
        }))
      : []
    const expandedWorldview = Array.isArray(parsed.expandedWorldview)
      ? parsed.expandedWorldview.slice(0, 2).map((r) => ({
          type: normalizeWorldviewType(r.type, '法则'),
          title: r.title?.trim() || '补充设定',
          content: r.content?.trim() || 'AI 未返回有效内容'
        }))
      : []
    return { supportingCharacters, organizations, relationships, outlineBeats, expandedWorldview } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const r = result as unknown as SpiralExpandResult
    return Boolean(
      r.supportingCharacters?.length > 0 &&
      r.outlineBeats?.length > 0
    )
  }
}
export default handler
