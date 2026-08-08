import type { AppSettings, AiTaskPayload, AiRunMeta } from '../shared-types'
import type {
  SpiralSeedResult,
  SpiralExpandResult,
  SpiralValidateResult,
  SpiralBootstrapResult,
  SpiralProgressEvent
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

  // 第二圈失败时降级：用空 expand 结果，仍可从 seed 创建基础 workspace
  let expand: SpiralExpandResult = EMPTY_EXPAND
  onProgress?.({ phase: 'expand', status: 'running' })
  try {
    const expandPayload: AiTaskPayload = {
      task: 'spiral-expand',
      settings: input.settings,
      context: { ...baseContext, spiralSeedResult: seed }
    }
    const expandResponse = await runAiTask(expandPayload, undefined, signal)
    onRunMeta?.(expandResponse.meta)
    expand = expandResponse.result as unknown as SpiralExpandResult
    onProgress?.({ phase: 'expand', status: 'done', result: expand })
  } catch (error) {
    const meta = error && typeof error === 'object' && 'aiRunMeta' in error
      ? (error as { aiRunMeta?: AiRunMeta }).aiRunMeta
      : undefined
    if (meta) onRunMeta?.(meta)
    if (signal?.aborted) throw new Error('螺旋生成已取消')
    onProgress?.({ phase: 'expand', status: 'error', error: error instanceof Error ? error.message : '展开失败' })
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
