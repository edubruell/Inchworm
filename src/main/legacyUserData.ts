/**
 * `app.getPath('userData')` follows `productName`, so the Inchworm rename left
 * every existing install's `projects.json` and `settings.json` sitting under
 * the old `wikiviewer` folder, invisible to the renamed build. Copied once,
 * best-effort, with `COPYFILE_EXCL` doing double duty as the idempotency
 * check: a destination that already exists (a second launch, or an install
 * that never had a `wikiviewer` folder) is left untouched, and any other
 * failure is swallowed the same way a missing store file already is —
 * refusing to start over a lost launcher row is not this app's call to make.
 */

import { constants as fsConstants } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const LEGACY_PRODUCT_NAME = 'wikiviewer'
const MIGRATED_FILES = ['projects.json', 'settings.json'] as const

export const migrateLegacyUserData = async (userDataDir: string): Promise<void> => {
  const legacyDir = join(dirname(userDataDir), LEGACY_PRODUCT_NAME)
  await Promise.all(
    MIGRATED_FILES.map((name) =>
      copyFile(join(legacyDir, name), join(userDataDir, name), fsConstants.COPYFILE_EXCL).catch(() => undefined),
    ),
  )
}
