// Builds the lite flavor: same app, but the live-collaboration feature is
// compiled out (HYDRO_LITE=1 turns __COLLAB__ into a dead branch, so the rtc
// chunks never get emitted). Installers land in dist/ next to the full ones
// with "-lite" in the file name. Same appId, so installing the full build
// over a lite install upgrades it in place.
//
//   npm run package:lite

import { spawnSync } from 'node:child_process'
import { readdirSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const liteOut = join(root, 'dist-lite')

function run(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, HYDRO_LITE: '1' }
  })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

rmSync(liteOut, { recursive: true, force: true })
run('npx', ['electron-vite', 'build'])
run('npx', ['electron-builder', '--publish', 'never', '-c.directories.output=dist-lite'])

mkdirSync(join(root, 'dist'), { recursive: true })
let moved = 0
for (const f of readdirSync(liteOut)) {
  const m = f.match(/^(.+)\.(exe|dmg|AppImage)$/)
  if (!m) continue
  renameSync(join(liteOut, f), join(root, 'dist', `${m[1]}-lite.${m[2]}`))
  moved++
}
if (!moved) {
  console.error('No installers found in dist-lite - electron-builder output changed?')
  process.exit(1)
}
console.log(`Moved ${moved} lite installer(s) into dist/.`)

// out/ now holds the lite bundles; rebuild so a following plain
// `electron-builder` or `npm start` does not accidentally ship lite.
spawnSync('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit', shell: true })
