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
      system: `${capabilityPreamble.system}\n\n你是资深小说策划编辑。你的任务是把作者的原始简介整理成一份既能直接展示给读者、又能作为后续角色、世界观和大纲生成依据的故事简介。必须忠于作者已有创意，不得用套路化设定替换原意。只返回 JSON，不要输出 Markdown、标题、分析、修改说明或额外建议。`,
      user: `${capabilityPreamble.user}\n\n作品名：${String(context.projectTitle ?? '') || '未命名作品'}\n作品题材：${String(context.projectGenre ?? '')}\n目标篇幅：${String(context.projectNovelLengthLabel ?? '')}\n\n用户原始简介：\n${String(context.premise ?? '')}\n\n优化要求：\n1. 识别并保留原文中的主角、关键身份、时代或世界背景、触发事件、核心目标、主要阻力、失败代价和明确的故事走向；原文没有的信息不要擅自补造专有名词、人物、能力体系或反派\n2. 按“故事背景与主角处境 → 触发事件 → 主角必须采取的行动 → 核心阻力与代价 → 未决悬念”重组信息，让故事因果清楚，并让后续 AI 能从简介中稳定提取创作锚点\n3. 短篇应聚焦单一核心冲突和可闭环目标；长篇应保留角色成长空间、持续性矛盾和可扩展主线，但不要凭空增加支线\n4. 原文信息不足时，只做清晰化和适度展开，用中性表达保留空白，不自行决定关键剧情；原文已有结局方向时必须保留，不得改成相反走向\n5. 删除重复、空泛评价和解释性废话，使用具体、自然、有画面感的中文；不要堆砌形容词，不写广告口号，不使用“这是一个关于”“命运的齿轮”等套话\n6. 输出 2-4 个连贯自然段，通常控制在 180-500 字；原文很短且信息有限时可以少于 180 字，但不得为了凑字数编造内容\n7. 不添加标题、书名号、标签、列表或创作说明，只输出可直接保存的简介正文\n\n返回格式：{"premise":"优化后的小说简介"}`
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
