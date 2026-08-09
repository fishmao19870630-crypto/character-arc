import type { AppSettings, AiTaskPayload, AiRunMeta } from '../shared-types'
import type {
  SpiralCharacterRelationship,
  SpiralSeedResult,
  SpiralExpandResult,
  SpiralOrganization,
  SpiralOutlineBeat,
  SpiralSupportingCharacter,
  SpiralValidateResult,
  SpiralBootstrapResult,
  SpiralProgressEvent,
  SpiralWorldRule
} from './types'
import { runAiTask } from '../runtime/orchestrator'

/** 螺旋引导流程的输入参数 */
export interface SpiralBootstrapInput {
  settings: AppSettings
  projectTitle: string
  projectGenre: string
  projectNovelLength: 'short' | 'long'
  projectPremise: string
  projectId?: string
  projectSkills?: unknown[]
}

/** 螺旋引导进度回调函数类型 */
export type SpiralProgressCallback = (event: SpiralProgressEvent) => void
export type SpiralRunMetaCallback = (meta: AiRunMeta) => void

async function runSpiralTask<T>(
  payload: AiTaskPayload,
  signal?: AbortSignal,
  onRunMeta?: SpiralRunMetaCallback
): Promise<T> {
  try {
    const response = await runAiTask(payload, undefined, signal)
    onRunMeta?.(response.meta)
    return response.result as unknown as T
  } catch (error) {
    const meta = error && typeof error === 'object' && 'aiRunMeta' in error
      ? (error as { aiRunMeta?: AiRunMeta }).aiRunMeta
      : undefined
    if (meta) onRunMeta?.(meta)
    throw error
  }
}

/** expand 阶段降级时使用的空结果 */
const EMPTY_EXPAND: SpiralExpandResult = {
  supportingCharacters: [],
  organizations: [],
  relationships: [],
  outlineBeats: [],
  expandedWorldview: []
}

/** validate 阶段降级时使用的空结果 */
const EMPTY_VALIDATE: SpiralValidateResult = {
  arcValidation: { isComplete: true, gaps: [] },
  plotCausalChain: { isSound: true, breaks: [] },
  settingConsistency: { isConsistent: true, contradictions: [] },
  patches: { characterAdjustments: [], outlineAdjustments: [], worldviewAdditions: [] }
}

/**
 * 执行螺旋引导流程：依次运行 seed → expand → validate 三个 AI 圈
 * 后续阶段失败时自动降级，保证至少能从 seed 生成基础 workspace
 * @param input - 项目配置与上下文信息
 * @param onProgress - 可选的进度回调
 * @param signal - 可选的中止信号
 * @returns 三圈结果的汇总对象
 */
export async function runSpiralBootstrap(
  input: SpiralBootstrapInput,
  onProgress?: SpiralProgressCallback,
  signal?: AbortSignal,
  onRunMeta?: SpiralRunMetaCallback
): Promise<SpiralBootstrapResult> {
  const baseContext: Record<string, unknown> = {
    projectTitle: input.projectTitle,
    projectGenre: input.projectGenre,
    projectNovelLength: input.projectNovelLength,
    projectPremise: input.projectPremise,
    projectId: input.projectId ?? '',
    projectSkills: input.projectSkills ?? []
  }

  // 第一圈必须成功，否则无法继续
  onProgress?.({ phase: 'seed', status: 'running' })
  const seedPayload: AiTaskPayload = {
    task: 'spiral-seed',
    settings: input.settings,
    context: { ...baseContext }
  }
  let seedResponse
  try {
    seedResponse = await runAiTask(seedPayload, undefined, signal)
    onRunMeta?.(seedResponse.meta)
  } catch (error) {
    const meta = error && typeof error === 'object' && 'aiRunMeta' in error
      ? (error as { aiRunMeta?: AiRunMeta }).aiRunMeta
      : undefined
    if (meta) onRunMeta?.(meta)
    throw error
  }
  const seed = seedResponse.result as unknown as SpiralSeedResult
  onProgress?.({ phase: 'seed', status: 'done', result: seed })

  if (signal?.aborted) throw new Error('螺旋生成已取消')

  // 第二圈拆成多次专门请求，减少单次大 JSON 漏掉角色、组织或大纲字段的概率。
  let expand: SpiralExpandResult = EMPTY_EXPAND
  onProgress?.({ phase: 'expand', status: 'running' })
  try {
    const charactersResult = await runSpiralTask<{ supportingCharacters: SpiralSupportingCharacter[] }>({
      task: 'spiral-characters',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed }
    }, signal, onRunMeta)
    const supportingCharacters = charactersResult.supportingCharacters

    const organizationsResult = await runSpiralTask<{ organizations: SpiralOrganization[] }>({
      task: 'spiral-organizations',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed, supportingCharacters }
    }, signal, onRunMeta)
    const organizations = organizationsResult.organizations

    const relationshipsResult = await runSpiralTask<{ relationships: SpiralCharacterRelationship[] }>({
      task: 'spiral-relationships',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed, supportingCharacters, organizations }
    }, signal, onRunMeta)
    const relationships = relationshipsResult.relationships

    const worldviewResult = await runSpiralTask<{ expandedWorldview: SpiralWorldRule[] }>({
      task: 'spiral-worldview-expand',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed, supportingCharacters, organizations, relationships }
    }, signal, onRunMeta)
    const expandedWorldview = worldviewResult.expandedWorldview

    const outlineResult = await runSpiralTask<{ outlineBeats: SpiralOutlineBeat[] }>({
      task: 'spiral-outline',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed, supportingCharacters, organizations, relationships, expandedWorldview }
    }, signal, onRunMeta)
    const outlineBeats = outlineResult.outlineBeats

    expand = { supportingCharacters, organizations, relationships, outlineBeats, expandedWorldview }
    onProgress?.({ phase: 'expand', status: 'done', result: expand })
  } catch (error) {
    if (signal?.aborted) throw new Error('螺旋生成已取消')
    onProgress?.({ phase: 'expand', status: 'error', error: error instanceof Error ? error.message : '展开失败' })
    throw error
  }

  if (signal?.aborted) throw new Error('螺旋生成已取消')

  // 第三圈失败时降级：跳过校验，不应用 patches
  let validate: SpiralValidateResult = EMPTY_VALIDATE
  onProgress?.({ phase: 'validate', status: 'running' })
  try {
    const validatePayload: AiTaskPayload = {
      task: 'spiral-validate',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed, spiralExpandResult: expand }
    }
    const validateResponse = await runAiTask(validatePayload, undefined, signal)
    onRunMeta?.(validateResponse.meta)
    validate = validateResponse.result as unknown as SpiralValidateResult
    onProgress?.({ phase: 'validate', status: 'done', result: validate })
  } catch (error) {
    const meta = error && typeof error === 'object' && 'aiRunMeta' in error
      ? (error as { aiRunMeta?: AiRunMeta }).aiRunMeta
      : undefined
    if (meta) onRunMeta?.(meta)
    if (signal?.aborted) throw new Error('螺旋生成已取消')
    onProgress?.({ phase: 'validate', status: 'error', error: error instanceof Error ? error.message : '校验失败' })
  }

  return { seed, expand, validate }
}
