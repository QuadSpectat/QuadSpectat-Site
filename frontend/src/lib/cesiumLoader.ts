/**
 * On-demand loader for the CesiumJS global build.
 *
 * Cesium (1.6 MB gzip) is only needed on the viewer routes (/app, /v/<token>). The production build externalises the
 * 'cesium' import to the `Cesium` global, so viewer code must not be evaluated before this promise resolves:
 * main.tsx awaits loadCesium() before importing the viewer route chunks. In dev the npm package is bundled normally.
 */
type CesiumWindow = Window & { Cesium?: unknown; CESIUM_BASE_URL?: string }

let pending: Promise<void> | null = null

export function loadCesium(): Promise<void> {
  const w = window as CesiumWindow
  if (import.meta.env.DEV || w.Cesium) return Promise.resolve()
  if (pending) return pending

  const dir = import.meta.env.BASE_URL + __CESIUM_DIR__
  w.CESIUM_BASE_URL = dir

  if (!document.querySelector('link[data-cesium-css]')) {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = dir + 'Widgets/widgets.css'
    css.setAttribute('data-cesium-css', '')
    document.head.appendChild(css)
  }

  pending = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = dir + 'Cesium.js'
    s.async = true
    s.onload = () => (w.Cesium ? resolve() : fail(new Error('The 3D engine loaded but did not start.')))
    s.onerror = () => fail(new Error('Could not download the 3D engine. Check your connection.'))
    function fail(err: Error) {
      s.remove()
      pending = null   // allow a retry
      reject(err)
    }
    document.head.appendChild(s)
  })
  return pending
}
