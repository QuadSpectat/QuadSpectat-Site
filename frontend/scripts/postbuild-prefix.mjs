// Shared-domain build (VITE_BASE=/_viewer/): make dist/_viewer/ a complete copy of the files the page references,
// so a static host that keeps the path prefix finds /_viewer/assets/*, /_viewer/cesium/*, /_viewer/logo.svg.
// dist/index.html stays at the root as the single-page-app fallback for /app, /drone, /admin and /v/<token>.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const base = (process.env.VITE_BASE ?? '/').replace(/^\/|\/$/g, '')
if (!base) { console.log('postbuild-prefix: VITE_BASE not set, nothing to do'); process.exit(0) }
const dist = 'dist', target = join(dist, base)
mkdirSync(target, { recursive: true })
for (const name of ['assets', 'logo.svg', 'logo.png']) {
  if (existsSync(join(dist, name))) cpSync(join(dist, name), join(target, name), { recursive: true })
}
console.log(`postbuild-prefix: copied app files into ${target}`)
