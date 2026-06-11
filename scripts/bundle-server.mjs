// Bundles the Node server into a single CJS file for the packaged desktop app.
// node-pty is a native addon — it can't be bundled, so we keep it external and
// copy the package next to the bundle, where require() resolves it at runtime.
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'src-tauri', 'resources')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// optional native deps of ws / node-pty — left external, app works without them
const external = ['node-pty', 'bufferutil', 'utf-8-validate']

await build({
  entryPoints: [join(root, 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm', // the server uses top-level await
  target: 'node22',
  outfile: join(out, 'server.mjs'),
  external,
  // provide require() for the external native deps that bundled libs load
  banner: { js: "import { createRequire as _cr } from 'node:module'; const require = _cr(import.meta.url);" },
  logLevel: 'info',
})

// ship node-pty (with its native prebuild) so the bundle can import it —
// resolve it from the server package where it's actually installed
const serverRequire = createRequire(join(root, 'server', 'package.json'))
const ptyRoot = dirname(serverRequire.resolve('node-pty/package.json'))
cpSync(ptyRoot, join(out, 'node_modules', 'node-pty'), { recursive: true, dereference: true })

console.log('✓ bundled server → src-tauri/resources/server.cjs (+ node-pty)')
