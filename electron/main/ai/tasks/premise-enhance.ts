import type { AiTaskResult, PremiseEnhanceResult } from '../shared-types'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject, jsonStringField } from './base'

const handler: TaskHandler = {
  name: 'premise-enhance',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input

    return {
      system: `${capabilityPreamble.system}\n\n你是小说简介编辑。你的任务是在不改变作者核心创意和既有剧情事实的前提下，把用户提供的小说简介改写得更清晰、更有吸引力。只返回 JSON，不要输出 Markdown、标题、分析或解释。`,
      user: `${capabilityPreamble.user}\n\n作品名：${String(context.projectTitle ?? '') || '未命名作品'}\n作品题材：${String(context.projectGenre ?? '')}\n目标篇幅：${String(context.projectNovelLengthLabel ?? '')}\n\n用户原始简介：\n${String(context.premise ?? '')}\n\n优化要求：\n1. 保留作者原有的角色、设定、冲突和故事走向，不擅自增加会改变故事性质的新设定\n2. 优先明确主角身份、核心矛盾、行动目标和最具吸引力的故事钩子\n3. 删除重复、空泛和解释性过强的表达，让因果关系清楚、语言自然有张力\n4. 不使用“这是一个关于”等套话，不堆砌形容词，不写宣传口号，不添加书名号或标题\n5. 输出一段可直接用作小说简介的完整中文文本，最多 800 字\n\n返回格式：{"premise":"优化后的小说简介"}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    return {
      premise: jsonStringField(parsed.premise)
    } as PremiseEnhanceResult
  },
  validate(result: AiTaskResult): boolean {
    const premise = (result as PremiseEnhanceResult).premise?.trim() ?? ''
    return premise.length > 0 && premise.length <= 800
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const premise = (result as PremiseEnhanceResult).premise?.trim() ?? ''
    if (!premise) return ['缺少 premise。']
    if (premise.length > 800) return ['premise 不能超过 800 字。']
    return []
  }
}

export default handler
