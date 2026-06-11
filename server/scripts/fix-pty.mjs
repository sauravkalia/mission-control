// node-pty's darwin prebuilds ship spawn-helper without the executable bit
// (mode 644 → "posix_spawnp failed"). Locate via require.resolve so the .pnpm
// virtual-store layout can't break the path.
import { createRequire } from 'node:module'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

try {
  const ptyMain = require.resolve('node-pty')
  const pkgRoot = join(dirname(ptyMain), '..')
  const prebuilds = join(pkgRoot, 'prebuilds')
  if (existsSync(prebuilds)) {
    for (const platformDir of readdirSync(prebuilds)) {
      const helper = join(prebuilds, platformDir, 'spawn-helper')
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  }
} catch {
  // node-pty not installed yet (first install pass) — postinstall reruns after it is
}
