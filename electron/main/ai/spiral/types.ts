/** 螺旋 seed 阶段生成的主角设定 */
export interface SpiralProtagonist {
  name: string
  tags: string[]
  coreDesire: string
  coreFlaw: string
  innerConflict: string
}

/** 螺旋 seed 阶段生成的主线弧光 */
export interface SpiralMainArc {
  premise: string
  centralQuestion: string
  endingDirection: string
}

/** 螺旋流程中生成的世界观规则 */
export interface SpiralWorldRule {
  type: string
  title: string
  content: string
}

/** seed（第一圈）的输出结果 */
export interface SpiralSeedResult {
  protagonist: SpiralProtagonist
  mainArc: SpiralMainArc
  worldRules: SpiralWorldRule[]
}

/** 螺旋 expand 阶段生成的配角设定 */
export interface SpiralSupportingCharacter {
  name: string
  role: string
  tags: string[]
  relationToProtagonist: string
  motivation: string
}

/** 螺旋展开阶段生成的组织/势力及其成员归属 */
export interface SpiralOrganization {
  name: string
  type: string
  description: string
  motto: string
  members: Array<{ characterName: string; role: string; notes: string }>
}

/** 螺旋展开阶段生成的人物关系 */
export interface SpiralCharacterRelationship {
  fromCharacter: string
  toCharacter: string
  type: string
  description: string
  intensity: number
}

/** 螺旋 expand 阶段生成的大纲节拍 */
export interface SpiralOutlineBeat {
  title: string
  conflict: string
  characterDriven: string
  summary: string
  wordTarget: string
  relatedCharacters: string[]
  relatedOrganizations: string[]
  relatedWorldview: string[]
}

/** expand（第二圈）的输出结果 */
export interface SpiralExpandResult {
  supportingCharacters: SpiralSupportingCharacter[]
  organizations: SpiralOrganization[]
  relationships: SpiralCharacterRelationship[]
  outlineBeats: SpiralOutlineBeat[]
  expandedWorldview: SpiralWorldRule[]
}

/** validate（第三圈）的输出结果，包含校验结论与修复补丁 */
export interface SpiralValidateResult {
  arcValidation: {
    isComplete: boolean
    gaps: string[]
  }
  plotCausalChain: {
    isSound: boolean
    breaks: string[]
  }
  settingConsistency: {
    isConsistent: boolean
    contradictions: string[]
  }
  patches: {
    characterAdjustments?: Array<{ name: string; field: string; before: string; after: string }>
    outlineAdjustments?: Array<{ title: string; field: string; before: string; after: string }>
    worldviewAdditions?: SpiralWorldRule[]
  }
}

/** 螺旋引导流程三圈的完整汇总结果 */
export interface SpiralBootstrapResult {
  seed: SpiralSeedResult
  expand: SpiralExpandResult
  validate: SpiralValidateResult
}

/** 螺旋流程的三个阶段 */
export type SpiralPhase = 'seed' | 'expand' | 'validate'

/** 螺旋流程的进度事件，通过回调实时通知调用方 */
export interface SpiralProgressEvent {
  phase: SpiralPhase
  status: 'running' | 'done' | 'error'
  result?: SpiralSeedResult | SpiralExpandResult | SpiralValidateResult
  error?: string
}
