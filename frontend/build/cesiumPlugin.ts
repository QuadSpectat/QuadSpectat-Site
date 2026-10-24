import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Cesium version (from node_modules); it is part of the asset path so a new engine never reuses an old cached URL. */
export const CESIUM_VERSION: string = (JSON.parse(readFileSync(fileURLToPath(new URL('../node_modules/cesium/package.json', import.meta.url)), 'utf8')) as { version: string }).version
/** Directory (relative to the app base) where the Cesium build is copied, e.g. "cesium-1.141.0/". */
export const CESIUM_DIR = `cesium-${CESIUM_VERSION}/`

/** Routes that need the globe (must match src/main.tsx). The entry chunk of each is modulepreloaded in parallel with Cesium.js. */
const VIEWER_ROUTES: { test: string; entry: string }[] = [
  { test: '^/app(/|$)', entry: 'src/App.tsx' },
  { test: '^/v/', entry: 'src/pages/SharedViewer.tsx' },
]

/**
 * Production-only companion to vite-plugin-cesium:
 *  - removes the render-blocking <script src=Cesium.js> and widgets.css it injects into every page
 *    (src/lib/cesiumLoader.ts loads them on demand, only for viewer routes),
 *  - adds a tiny inline script that, on viewer routes, starts downloading Cesium.js, its CSS and the route chunk
 *    during HTML parse (preload / modulepreload) so the download is parallel with the app bundle.
 */
export function cesiumDeferred(): Plugin {
  return {
    name: 'qs-cesium-deferred',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        let out = html
          .replace(/\s*<script src="[^"]*Cesium\.js"><\/script>/, '')
          .replace(/\s*<link rel="stylesheet" href="[^"]*Widgets\/widgets\.css">/, '')
        const viteBase = process.env.VITE_BASE ?? '/'
        const prefix = viteBase.endsWith('/') ? viteBase : viteBase + '/'
        const chunkFiles = (entrySuffix: string): string[] => {
          const bundle = ctx.bundle
          if (!bundle) return []
          const seen = new Set<string>()
          const visit = (name: string) => {
            const c = bundle[name]
            if (!c || c.type !== 'chunk' || seen.has(name)) return
            seen.add(name)
            c.imports.forEach(visit)
          }
          for (const [name, c] of Object.entries(bundle)) {
            if (c.type === 'chunk' && c.isDynamicEntry && (c.facadeModuleId ?? '').split(String.fromCharCode(92)).join('/').endsWith(entrySuffix)) visit(name)
          }
          // The shared entry chunk is already loaded by the page itself.
          for (const [name, c] of Object.entries(bundle)) if (c.type === 'chunk' && c.isEntry) seen.delete(name)
          return [...seen].map((f) => prefix + f)
        }
        const routes = VIEWER_ROUTES.map((r) => ({ re: r.test, files: chunkFiles(r.entry) }))
        const cfg = JSON.stringify({ js: prefix + CESIUM_DIR + 'Cesium.js', css: prefix + CESIUM_DIR + 'Widgets/widgets.css', routes })
        const script = `<script>(function(c){try{var p=location.pathname,d=document,h=d.head;for(var i=0;i<c.routes.length;i++){if(new RegExp(c.routes[i].re).test(p)){` +
          `var a=function(r,u,as){var l=d.createElement('link');l.rel=r;l.href=u;if(as)l.as=as;h.appendChild(l)};` +
          `a('preload',c.js,'script');a('preload',c.css,'style');c.routes[i].files.forEach(function(f){a('modulepreload',f)});` +
          `d.documentElement.setAttribute('data-viewer','1');break}}}catch(e){}})(${cfg})</script>`
        // Before the module script so the downloads start as early as possible (the SPA path-restore script runs first).
        out = out.replace('<script type="module"', () => `${script}\n    <script type="module"`)
        return out
      },
    },
  }
}
