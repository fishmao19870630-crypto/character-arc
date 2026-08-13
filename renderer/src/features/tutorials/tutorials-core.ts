export type TutorialResourceType = 'feishu' | 'bilibili' | 'github' | 'external'

export type TutorialResource = {
  id: string
  type: TutorialResourceType
  title: string
  description: string
  url: string
  enabled: boolean
}

export type TutorialDocument = {
  version: number
  updatedAt: string
  title: string
  intro: string
  resources: TutorialResource[]
}

export type TutorialResolution = {
  document: TutorialDocument
  stale: boolean
}

const RESOURCE_TYPES = new Set<TutorialResourceType>(['feishu', 'bilibili', 'github', 'external'])

function normalizeResource(value: unknown, index: number): TutorialResource | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<TutorialResource>
  const title = String(item.title ?? '').trim()
  const url = String(item.url ?? '').trim()
  const type = RESOURCE_TYPES.has(item.type as TutorialResourceType)
    ? item.type as TutorialResourceType
    : 'external'
  if (!title) return null
  return {
    id: String(item.id ?? `tutorial-resource-${index}`).trim() || `tutorial-resource-${index}`,
    type,
    title,
    description: String(item.description ?? '').trim(),
    url,
    enabled: item.enabled !== false
  }
}

export function normalizeTutorial(value: unknown): TutorialDocument | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<TutorialDocument>
  const resources = Array.isArray(item.resources)
    ? item.resources.map(normalizeResource).filter((resource): resource is TutorialResource => Boolean(resource))
    : []
  const title = String(item.title ?? '').trim()
  if (!title || resources.length === 0) return null
  return {
    version: Number.isFinite(Number(item.version)) ? Number(item.version) : 1,
    updatedAt: String(item.updatedAt ?? '').trim(),
    title,
    intro: String(item.intro ?? '').trim(),
    resources
  }
}

export function resolveFreshTutorial(value: unknown, fallback: TutorialDocument): TutorialResolution {
  const remote = normalizeTutorial(value)
  if (!remote || (fallback.updatedAt && (!remote.updatedAt || remote.updatedAt < fallback.updatedAt))) {
    return { document: fallback, stale: Boolean(remote) }
  }
  return { document: remote, stale: false }
}

