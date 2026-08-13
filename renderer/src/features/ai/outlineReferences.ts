export type OutlineReferenceEntity = {
  id: string
  name?: string
  title?: string
}
function referenceCandidate(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  return String(record.id ?? record.name ?? record.title ?? '').trim()
}

/** 将模型返回的实体 ID、名称或正文中的明确名称统一解析为真实 ID。 */
export function resolveOutlineReferenceIds(
  value: unknown,
  entities: OutlineReferenceEntity[],
  referenceText = ''
): string[] {
  const validIds = new Set(entities.map((entity) => entity.id))
  const idByLabel = new Map<string, string>()
  for (const entity of entities) {
    const label = String(entity.name ?? entity.title ?? '').trim()
    if (label) idByLabel.set(label, entity.id)
  }

  const resolved: string[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = referenceCandidate(item)
      const id = validIds.has(candidate) ? candidate : idByLabel.get(candidate)
      if (id && !resolved.includes(id)) resolved.push(id)
    }
  }

  for (const [label, id] of idByLabel) {
    if (label.length >= 2 && referenceText.includes(label) && !resolved.includes(id)) {
      resolved.push(id)
    }
  }
  return resolved.slice(0, 12)
}
