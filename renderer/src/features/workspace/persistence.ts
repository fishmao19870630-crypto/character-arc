import { ref, type Ref } from 'vue'
import { FAST_PERSIST_DELAY_MS, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AppSettings, ThemeName } from '@/types/app'
import type { StoredState } from './storeHelpers'

const SETTINGS_PERSIST_DELAY_MS = 300
const WORKSPACE_SYNC_DELAY_MS = 120

export interface WorkspacePersistenceDeps {
  hasHydrated: Ref<boolean>
  serializeWorkspaceState: () => StoredState
  getSettingsSnapshot: () => {
    theme: ThemeName
    selectedProjectId: string
    appSettings: AppSettings
  }
  applyRemoteState: (payload: Partial<StoredState>) => void
}

export function createWorkspacePersistence(deps: WorkspacePersistenceDeps) {
  let saveTimer: number | null = null
  let settingsSaveTimer: number | null = null
  let workspaceSyncTimer: number | null = null
  let persistPromise: Promise<void> | null = null
  let persistRequested = false
  let isApplyingRemoteWorkspaceSync = false
  const scheduledPersistAt = ref<number | null>(null)
  const isPersisting = ref(false)
  const persistenceError = ref<string | null>(null)

  function scheduleWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
    }
    workspaceSyncTimer = window.setTimeout(() => {
      void window.characterArc.publishWorkspaceSync(toIpcPayload(deps.serializeWorkspaceState()))
    }, WORKSPACE_SYNC_DELAY_MS)
  }

  function flushWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
      workspaceSyncTimer = null
    }
    const result = window.characterArc.saveWorkspaceSync(toIpcPayload(deps.serializeWorkspaceState()))
    persistenceError.value = result.success ? null : result.error ?? '保存失败'
    if (result.success) {
      scheduledPersistAt.value = null
    }
  }

  function persistWorkspace(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    scheduledPersistAt.value = null
    persistRequested = true

    if (persistPromise) {
      return persistPromise
    }

    persistPromise = (async () => {
      isPersisting.value = true
      try {
        while (persistRequested) {
          persistRequested = false
          let result: { success: boolean; error?: string }
          try {
            result = await window.characterArc.saveWorkspace(toIpcPayload(deps.serializeWorkspaceState()))
          } catch (error) {
            const message = error instanceof Error ? error.message : '保存失败'
            console.error('[workspace] saveWorkspace failed:', error)
            persistenceError.value = message
            persistRequested = false
            return
          }
          if (!result.success) {
            console.error('[workspace] saveWorkspace failed:', result.error)
          }
          persistenceError.value = result.success ? null : result.error ?? '保存失败'
          if (!result.success) {
            persistRequested = false
          }
        }
      } finally {
        isPersisting.value = false
        persistPromise = null
      }
    })()

    return persistPromise
  }

  async function persistAppSettings(): Promise<void> {
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer)
      settingsSaveTimer = null
    }
    const result = await window.characterArc.saveAppSettings(toIpcPayload(deps.getSettingsSnapshot()))
    if (!result.success) {
      console.error('[workspace] saveAppSettings failed:', result.error)
      persistenceError.value = result.error ?? '保存失败'
    } else {
      persistenceError.value = null
    }
  }

  function schedulePersist(
    mode: 'fast' | 'autosave' = 'autosave',
    options: { syncWorkspace?: boolean } = {}
  ): void {
    if (!deps.hasHydrated.value) {
      return
    }
    if (options.syncWorkspace !== false) {
      scheduleWorkspaceSync()
    }
    const delay =
      mode === 'fast'
        ? FAST_PERSIST_DELAY_MS
        : resolveAutoSaveDelayMs(deps.getSettingsSnapshot().appSettings.autoSaveInterval)
    const nextPersistAt = Date.now() + delay
    if (mode === 'autosave' && saveTimer && scheduledPersistAt.value !== null) {
      return
    }
    scheduledPersistAt.value = nextPersistAt
    if (saveTimer) {
      window.clearTimeout(saveTimer)
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void persistWorkspace()
    }, delay)
  }

  function scheduleSettingsPersist(options: { flushWorkspace?: boolean } = {}): void {
    if (!deps.hasHydrated.value) return
    if (options.flushWorkspace !== false) {
      scheduleWorkspaceSync()
      // Saving most settings should also flush any queued workspace edits before the app closes.
      schedulePersist('fast')
    }
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer)
    }
    settingsSaveTimer = window.setTimeout(() => {
      void persistAppSettings()
    }, SETTINGS_PERSIST_DELAY_MS)
  }

  function handleRemoteWorkspaceSync(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return
    }
    isApplyingRemoteWorkspaceSync = true
    try {
      deps.applyRemoteState(payload as Partial<StoredState>)
    } finally {
      isApplyingRemoteWorkspaceSync = false
    }
  }

  return {
    scheduledPersistAt,
    isPersisting,
    persistenceError,
    scheduleWorkspaceSync,
    flushWorkspaceSync,
    persistWorkspace,
    persistAppSettings,
    schedulePersist,
    scheduleSettingsPersist,
    handleRemoteWorkspaceSync
  }
}
