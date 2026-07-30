import { join, resolve } from 'node:path'

export const USER_DATA_PATH_ENV = 'CHARACTERARC_USER_DATA_PATH'

export function resolveUserDataPath(
  appDataPath: string,
  isPackaged: boolean,
  configuredPath: string | undefined
): { path: string; isOverride: boolean } {
  const override = configuredPath?.trim()
  return override
    ? { path: resolve(override), isOverride: true }
    : { path: join(appDataPath, isPackaged ? 'CharacterArc' : 'CharacterArc-Dev'), isOverride: false }
}
