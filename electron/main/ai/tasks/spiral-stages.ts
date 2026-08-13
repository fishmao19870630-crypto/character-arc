import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult } from '../shared-types'
import type {
  SpiralCharacterRelationship,
  SpiralOrganization,
  SpiralOutlineBeat,
  SpiralSeedResult,
  SpiralSupportingCharacter,
  SpiralWorldRule
} from '../spiral/types'
import { resolveWritingStyleInstruction } from '../prompts/shared'
import { resolveProjectBootstrapPromptParts } from '../prompts/bootstrap-strategies'
import { normalizeWorldviewType } from './worldview-type'

const SUPPORTING_CHARACTER_MIN = 6
const SUPPORTING_CHARACTER_MAX = 8
const ORGANIZATION_MIN = 3
const ORGANIZATION_MAX = 5
const RELATIONSHIP_MIN = 8
const RELATIONSHIP_MAX = 12
const EXPANDED_WORLDVIEW_MIN = 4
const EXPANDED_WORLDVIEW_MAX = 6

function hasTextLength(value: string, minimum: number): boolean {
  return value.trim().length >= minimum
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values.map((value) => value.trim())).size === values.length
}

function relationshipPairKey(relationship: SpiralCharacterRelationship): string {
  return [relationship.fromCharacter.trim(), relationship.toCharacter.trim()].sort().join('\u0000')
}

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

function seedBlock(seed?: SpiralSeedResult): string {
  return seed
    ? `主角：${seed.protagonist.name}
核心欲望：${seed.protagonist.coreDesire}
核心缺陷：${seed.protagonist.coreFlaw}
内在矛盾：${seed.protagonist.innerConflict}
故事前提：${seed.mainArc.premise}
核心问题：${seed.mainArc.centralQuestion}
结局方向：${seed.mainArc.endingDirection}
已有世界规则：
${seed.worldRules.map((r) => `- ${r.title}（${r.type}）：${r.content}`).join('\n')}`
    : '（无第一圈结果）'
}

function characterBlock(seed?: SpiralSeedResult, supporting: SpiralSupportingCharacter[] = []): string {
  const protagonist = seed ? [`- ${seed.protagonist.name}（主角）：欲望=${seed.protagonist.coreDesire}；缺陷=${seed.protagonist.coreFlaw}`] : []
  const supportingLines = supporting.map((c) => `- ${c.name}（${c.role}）：关系=${c.relationToProtagonist}；动机=${c.motivation}`)
  return [...protagonist, ...supportingLines].join('\n') || '暂无'
}

function organizationBlock(organizations: SpiralOrganization[] = []): string {
  return organizations.map((organization) => {
    const members = organization.members
      .map((member) => `${member.characterName}（${member.role}${member.notes ? `：${member.notes}` : ''}）`)
      .join('、')
    return `- ${organization.name}（${organization.type}）：${organization.description}${members ? `；成员：${members}` : ''}`
  }).join('\n') || '暂无'
}

function relationshipBlock(relationships: SpiralCharacterRelationship[] = []): string {
  return relationships
    .map((relationship) => `- ${relationship.fromCharacter} → ${relationship.toCharacter}（${relationship.type}）：${relationship.description}`)
    .join('\n') || '暂无'
}

function worldviewBlock(seed?: SpiralSeedResult, expanded: SpiralWorldRule[] = []): string {
  const seedRules = seed?.worldRules ?? []
  return [...seedRules, ...expanded]
    .map((rule) => `- ${rule.title}（${rule.type}）：${rule.content}`)
    .join('\n') || '暂无'
}

function baseProjectBlock(context: Record<string, unknown>): string {
  const { genreLabel, lengthLabel, strategyBlock } = resolveProjectBootstrapPromptParts(context)
  return `项目标题：${String(context.projectTitle ?? '')}
项目题材：${genreLabel}
作品长度：${lengthLabel}
小说简介：${String(context.projectPremise ?? '')}

题材与长度策略：
${strategyBlock}`
}

export const spiralCharacters: TaskHandler = {
  name: 'spiral-characters',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    return {
      system: `${capabilityPreamble.system}\n\n你是小说配角设计师。只负责基于核心骨架生成配角，不要生成组织、关系、大纲或补充设定。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n${baseProjectBlock(context)}

【核心骨架】
${seedBlock(context.spiralSeedResult as SpiralSeedResult | undefined)}

请生成 supportingCharacters：
1. 返回 ${SUPPORTING_CHARACTER_MIN}-${SUPPORTING_CHARACTER_MAX} 个配角，姓名不得重复
2. 每个包含 name、role、tags、relationToProtagonist、motivation；tags 返回 3-5 个身份、性格、能力或阵营标签
3. relationToProtagonist 写 60-120 字，说明关系起点、利益连接、当前冲突和可能变化
4. motivation 写 60-120 字，说明角色想得到什么、为什么必须得到、愿意付出什么代价，以及隐藏顾虑
5. 配角必须有独立目标，不能只是主角工具人；整体要覆盖盟友、对手、引路人、资源掌控者和不可控变量等不同叙事功能
6. 至少 2 个配角的利益与主角直接冲突，至少 2 个配角之间存在后续可发展的利益联系
7. ${writingStyle}

返回格式：{"supportingCharacters":[{"name":"","role":"","tags":[""],"relationToProtagonist":"","motivation":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const supportingCharacters = Array.isArray(parsed.supportingCharacters)
      ? parsed.supportingCharacters.slice(0, SUPPORTING_CHARACTER_MAX).map((c) => ({
          name: c.name?.trim() || '配角',
          role: c.role?.trim() || '待设定',
          tags: normalizeStringList(c.tags, c.role).slice(0, 5),
          relationToProtagonist: c.relationToProtagonist?.trim() || '待设定',
          motivation: c.motivation?.trim() || '待设定'
        }))
      : []
    return { supportingCharacters } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const characters = (result as { supportingCharacters?: SpiralSupportingCharacter[] }).supportingCharacters ?? []
    return characters.length >= SUPPORTING_CHARACTER_MIN &&
      hasUniqueValues(characters.map((character) => character.name)) &&
      characters.every((character) => (
      character.tags.length >= 3 &&
      hasTextLength(character.relationToProtagonist, 60) &&
      hasTextLength(character.motivation, 60)
    ))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const characters = (result as { supportingCharacters?: SpiralSupportingCharacter[] }).supportingCharacters ?? []
    const errors: string[] = []
    if (characters.length < SUPPORTING_CHARACTER_MIN) errors.push(`supportingCharacters 至少需要 ${SUPPORTING_CHARACTER_MIN} 个，当前为 ${characters.length} 个。`)
    if (!hasUniqueValues(characters.map((character) => character.name))) errors.push('supportingCharacters 的 name 不得重复。')
    if (characters.some((character) => character.tags.length < 3)) errors.push('每个配角至少需要 3 个 tags。')
    if (characters.some((character) => !hasTextLength(character.relationToProtagonist, 60))) errors.push('每个配角的 relationToProtagonist 至少需要 60 字。')
    if (characters.some((character) => !hasTextLength(character.motivation, 60))) errors.push('每个配角的 motivation 至少需要 60 字。')
    return errors
  },
  resolveMaxTokens() {
    return 3500
  }
}

export const spiralOrganizations: TaskHandler = {
  name: 'spiral-organizations',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'relations', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const seed = context.spiralSeedResult as SpiralSeedResult | undefined
    const supporting = context.supportingCharacters as SpiralSupportingCharacter[] | undefined
    return {
      system: `${capabilityPreamble.system}\n\n你是小说组织与势力设计师。只负责生成组织/势力和成员归属，不要生成大纲或人物关系。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n${baseProjectBlock(context)}

【核心骨架】
${seedBlock(seed)}

【已生成角色】
${characterBlock(seed, supporting)}

请生成 organizations：
1. 必须返回 ${ORGANIZATION_MIN}-${ORGANIZATION_MAX} 个与主线直接相关的组织、势力、机构、家族、团队或利益共同体，名称不得重复
2. 每个组织包含 name、type、description、motto、members
3. description 写 120-200 字，必须包含公开目标、真实利益、掌控资源、行动方式、内部规则、主要对手和结构弱点
4. 每个组织至少 2 个 members 成员归属；members 只能引用上方已生成角色姓名，并包含 characterName、role、notes
5. notes 写 40-80 字，说明成员的权限职责、真实立场、可利用资源和背叛或受罚风险
6. 各组织之间要形成合作、竞争或制衡，且每个组织都要影响至少一名角色的关键选择
7. motto 要简短鲜明，能体现组织价值观，不能与 description 重复
8. ${writingStyle}

返回格式：{"organizations":[{"name":"","type":"","description":"","motto":"","members":[{"characterName":"","role":"","notes":""}]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const organizations = Array.isArray(parsed.organizations)
      ? parsed.organizations.slice(0, ORGANIZATION_MAX).map((organization) => ({
          name: organization.name?.trim() || '未命名组织',
          type: organization.type?.trim() || '势力',
          description: organization.description?.trim() || '待补充组织定位。',
          motto: organization.motto?.trim() || '',
          members: Array.isArray(organization.members)
            ? organization.members.slice(0, 8).map((member: Record<string, unknown>) => ({
                characterName: String(member.characterName ?? '').trim(),
                role: String(member.role ?? '').trim() || '成员',
                notes: String(member.notes ?? '').trim()
              })).filter((member: { characterName: string }) => member.characterName)
            : []
        }))
      : []
    return { organizations } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const organizations = (result as { organizations?: SpiralOrganization[] }).organizations ?? []
    return organizations.length >= ORGANIZATION_MIN &&
      hasUniqueValues(organizations.map((organization) => organization.name)) &&
      organizations.every((organization) => (
      hasTextLength(organization.description, 120) &&
      Boolean(organization.motto.trim()) &&
      organization.members.length >= 2 &&
      organization.members.every((member) => hasTextLength(member.notes, 40))
    ))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const organizations = (result as { organizations?: SpiralOrganization[] }).organizations ?? []
    const errors: string[] = []
    if (organizations.length < ORGANIZATION_MIN) errors.push(`organizations 至少需要 ${ORGANIZATION_MIN} 个，当前为 ${organizations.length} 个。`)
    if (!hasUniqueValues(organizations.map((organization) => organization.name))) errors.push('organizations 的 name 不得重复。')
    if (organizations.some((organization) => !hasTextLength(organization.description, 120))) errors.push('每个组织的 description 至少需要 120 字。')
    if (organizations.some((organization) => !organization.motto.trim())) errors.push('每个组织必须包含 motto。')
    if (organizations.some((organization) => organization.members.length < 2)) errors.push('每个组织至少需要 2 个 members 成员归属。')
    if (organizations.some((organization) => organization.members.some((member) => !hasTextLength(member.notes, 40)))) errors.push('每条成员归属的 notes 至少需要 40 字。')
    return errors
  },
  resolveMaxTokens() {
    return 6000
  }
}

export const spiralRelationships: TaskHandler = {
  name: 'spiral-relationships',
  outputType: 'json',
  defaultCapabilities: ['settings', 'characters', 'relations', 'worldview', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const seed = context.spiralSeedResult as SpiralSeedResult | undefined
    const supporting = context.supportingCharacters as SpiralSupportingCharacter[] | undefined
    const organizations = context.organizations as SpiralOrganization[] | undefined
    return {
      system: `${capabilityPreamble.system}\n\n你是小说人物关系设计师。只负责生成角色之间的关系，不要生成组织、大纲或世界设定。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n${baseProjectBlock(context)}

【核心骨架】
${seedBlock(seed)}

【已生成角色】
${characterBlock(seed, supporting)}

【已生成组织】
${organizationBlock(organizations)}

请生成 relationships：
1. 返回 ${RELATIONSHIP_MIN}-${RELATIONSHIP_MAX} 条人物关系，不得用相同角色对重复凑数
2. fromCharacter 和 toCharacter 只能引用已生成角色姓名，不能自我关联
3. 每条包含 type、description、intensity（0-100）
4. description 写 80-160 字，必须包含关系起因、双方诉求、权力或情感张力、当前矛盾，以及会改变关系的触发事件
5. 关系网要覆盖全部角色；既要有主角关系，也至少包含 3 条配角之间的关系
6. 至少 2 条关系直接受到组织立场、资源争夺或成员身份影响
7. 关系类型要有差异，覆盖冲突、合作、利用、亏欠、竞争或情感牵引中的多个维度
8. ${writingStyle}

返回格式：{"relationships":[{"fromCharacter":"","toCharacter":"","type":"","description":"","intensity":70}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const relationships = Array.isArray(parsed.relationships)
      ? parsed.relationships.slice(0, RELATIONSHIP_MAX).map((relationship) => ({
          fromCharacter: relationship.fromCharacter?.trim() || '',
          toCharacter: relationship.toCharacter?.trim() || '',
          type: relationship.type?.trim() || '关系',
          description: relationship.description?.trim() || '待补充关系说明。',
          intensity: Math.min(100, Math.max(0, Number(relationship.intensity) || 50))
        })).filter((relationship) => relationship.fromCharacter && relationship.toCharacter && relationship.fromCharacter !== relationship.toCharacter)
      : []
    return { relationships } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const relationships = (result as { relationships?: SpiralCharacterRelationship[] }).relationships ?? []
    return relationships.length >= RELATIONSHIP_MIN &&
      hasUniqueValues(relationships.map(relationshipPairKey)) &&
      relationships.every((relationship) => hasTextLength(relationship.description, 80))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const relationships = (result as { relationships?: SpiralCharacterRelationship[] }).relationships ?? []
    const errors: string[] = []
    if (relationships.length < RELATIONSHIP_MIN) errors.push(`relationships 至少需要 ${RELATIONSHIP_MIN} 条，当前为 ${relationships.length} 条。`)
    if (!hasUniqueValues(relationships.map(relationshipPairKey))) errors.push('relationships 不得重复使用相同角色对。')
    if (relationships.some((relationship) => !hasTextLength(relationship.description, 80))) errors.push('每条关系的 description 至少需要 80 字。')
    return errors
  },
  resolveMaxTokens() {
    return 4000
  }
}

export const spiralWorldviewExpand: TaskHandler = {
  name: 'spiral-worldview-expand',
  outputType: 'json',
  defaultCapabilities: ['settings', 'worldview', 'characters', 'relations', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const seed = context.spiralSeedResult as SpiralSeedResult | undefined
    const supporting = context.supportingCharacters as SpiralSupportingCharacter[] | undefined
    const organizations = context.organizations as SpiralOrganization[] | undefined
    const relationships = context.relationships as SpiralCharacterRelationship[] | undefined
    return {
      system: `${capabilityPreamble.system}\n\n你是小说世界观补充设计师。只负责补充服务角色动机、组织目标和冲突推进的世界设定，不要生成大纲。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n${baseProjectBlock(context)}

【核心骨架与已有世界规则】
${seedBlock(seed)}

【已生成角色】
${characterBlock(seed, supporting)}

【已生成组织】
${organizationBlock(organizations)}

【已生成关系】
${relationshipBlock(relationships)}

请生成 expandedWorldview：
1. 返回 ${EXPANDED_WORLDVIEW_MIN}-${EXPANDED_WORLDVIEW_MAX} 条补充世界设定，标题不得重复
2. 每条包含 type、title、content
3. type 必须是 地理 / 法则 / 物种 / 势力 / 历史 之一
4. content 写 100-180 字，必须说明设定如何运作、适用边界、使用或违背的代价、影响到的角色或组织，以及可触发的剧情冲突
5. 补充设定要服务于组织目标、配角动机或人物关系冲突，至少覆盖 3 种不同 type
6. 不要重复已有世界规则，不要写与剧情无关的百科背景
7. 各条设定之间要能互相制约或形成因果联系
8. ${writingStyle}

返回格式：{"expandedWorldview":[{"type":"","title":"","content":""}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const expandedWorldview = Array.isArray(parsed.expandedWorldview)
      ? parsed.expandedWorldview.slice(0, EXPANDED_WORLDVIEW_MAX).map((rule) => ({
          type: normalizeWorldviewType(rule.type, '法则'),
          title: rule.title?.trim() || '补充设定',
          content: rule.content?.trim() || 'AI 未返回有效内容'
        }))
      : []
    return { expandedWorldview } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    const worldview = (result as { expandedWorldview?: SpiralWorldRule[] }).expandedWorldview ?? []
    return worldview.length >= EXPANDED_WORLDVIEW_MIN &&
      hasUniqueValues(worldview.map((rule) => rule.title)) &&
      new Set(worldview.map((rule) => rule.type)).size >= 3 &&
      worldview.every((rule) => hasTextLength(rule.content, 100))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const worldview = (result as { expandedWorldview?: SpiralWorldRule[] }).expandedWorldview ?? []
    const errors: string[] = []
    if (worldview.length < EXPANDED_WORLDVIEW_MIN) errors.push(`expandedWorldview 至少需要 ${EXPANDED_WORLDVIEW_MIN} 条，当前为 ${worldview.length} 条。`)
    if (!hasUniqueValues(worldview.map((rule) => rule.title))) errors.push('expandedWorldview 的 title 不得重复。')
    if (new Set(worldview.map((rule) => rule.type)).size < 3) errors.push('expandedWorldview 至少需要覆盖 3 种不同 type。')
    if (worldview.some((rule) => !hasTextLength(rule.content, 100))) errors.push('每条世界观 content 至少需要 100 字。')
    return errors
  },
  resolveMaxTokens() {
    return 2500
  }
}

export const spiralOutline: TaskHandler = {
  name: 'spiral-outline',
  outputType: 'json',
  defaultCapabilities: ['settings', 'outline', 'worldview', 'characters', 'relations', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const writingStyle = resolveWritingStyleInstruction(context)
    const seed = context.spiralSeedResult as SpiralSeedResult | undefined
    const supporting = context.supportingCharacters as SpiralSupportingCharacter[] | undefined
    const organizations = context.organizations as SpiralOrganization[] | undefined
    const relationships = context.relationships as SpiralCharacterRelationship[] | undefined
    const expandedWorldview = context.expandedWorldview as SpiralWorldRule[] | undefined
    const wordTargetRange = context.projectNovelLength === 'short' ? '1800 到 2800' : '3000 到 4000'
    return {
      system: `${capabilityPreamble.system}\n\n你是小说开篇大纲设计师。基于已经生成的核心骨架、角色、组织、关系和世界观，生成连续章节节拍。请只返回 JSON 对象，不要返回 Markdown。`,
      user: `${capabilityPreamble.user}\n\n${baseProjectBlock(context)}

【核心骨架】
${seedBlock(seed)}

【角色】
${characterBlock(seed, supporting)}

【组织】
${organizationBlock(organizations)}

【人物关系】
${relationshipBlock(relationships)}

【世界观】
${worldviewBlock(seed, expandedWorldview)}

请生成 outlineBeats：
1. 返回 3-5 个开篇章节大纲
2. 每个包含 title、conflict、characterDriven、summary、wordTarget、relatedCharacters、relatedOrganizations、relatedWorldview
3. title 必须使用“第N章：章节名”格式，从第1章开始连续编号
4. 每章预估字数必须控制在${wordTargetRange}字，wordTarget 返回纯数字
5. relatedCharacters 只能填角色姓名，relatedOrganizations 只能填组织名称，relatedWorldview 只能填世界规则或补充设定标题
6. 每章至少关联一个直接参与的角色，至少一章要关联组织
7. 大纲节拍之间要有因果递进，必须由角色选择驱动
8. ${writingStyle}

返回格式：{"outlineBeats":[{"title":"","conflict":"","characterDriven":"","summary":"","wordTarget":"","relatedCharacters":[""],"relatedOrganizations":[""],"relatedWorldview":[""]}]}`
    }
  },
  normalize(raw: string, context?: Record<string, unknown>): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const outlineBeats = Array.isArray(parsed.outlineBeats)
      ? parsed.outlineBeats.slice(0, 5).map((beat, index) => ({
          title: normalizeChapterTitle(beat.title, index),
          conflict: beat.conflict?.trim() || '待设定',
          characterDriven: beat.characterDriven?.trim() || '待设定',
          summary: beat.summary?.trim() || '待设定',
          wordTarget: normalizeChapterWordTarget(beat.wordTarget, context?.projectNovelLength),
          relatedCharacters: normalizeStringList(beat.relatedCharacters),
          relatedOrganizations: normalizeStringList(beat.relatedOrganizations),
          relatedWorldview: normalizeStringList(beat.relatedWorldview)
        }))
      : []
    return { outlineBeats } as unknown as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return ((result as { outlineBeats?: SpiralOutlineBeat[] }).outlineBeats?.length ?? 0) > 0
  }
}
