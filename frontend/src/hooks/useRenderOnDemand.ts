import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'

/** `?render=continuous` keeps Cesium's old always-rendering loop (for debugging a stale-frame bug). */
export function continuousRenderRequested(): boolean {
  try { return new URLSearchParams(window.location.search).get('render') === 'continuous' } catch { return false }
}

/**
 * The viewer is created with requestRenderMode, so a frame is drawn only when something asks for it. Cesium asks by
 * itself for camera movement, flights, tile/imagery loading. This hook adds every other trigger the app has:
 * gestures on the canvas, hover while a measuring tool is active, resize, scene collections changing, tab coming back.
 * `hoverActive` must be true while a tool needs mouse-move feedback (rubber band, pin cursor).
 * React state changes (sliders, toggles, measurements) are covered by `useRenderAfterCommit`.
 */
export function useRenderOnDemand(viewer: Cesium.Viewer | null, hoverActive: boolean): void {
  const hoverRef = useRef(hoverActive)
  hoverRef.current = hoverActive
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return
    const v = viewer
    const scene = v.scene
    const req = () => { if (!v.isDestroyed()) scene.requestRender() }
    const canvas = v.canvas
    const onMove = (e: PointerEvent) => { if (e.buttons || hoverRef.current) req() }
    const onVis = () => { if (document.visibilityState === 'visible') req() }
    const dom: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
      [canvas, 'pointerdown', req], [canvas, 'pointerup', req], [canvas, 'pointercancel', req],
      [canvas, 'pointermove', onMove as EventListener],
      [canvas, 'wheel', req, { passive: true }], [canvas, 'touchmove', req, { passive: true }],
      [canvas, 'dblclick', req], [window, 'resize', req], [window, 'orientationchange', req], [document, 'visibilitychange', onVis],
    ]
    dom.forEach(([t, n, f, o]) => t.addEventListener(n, f, o))
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) { ro = new ResizeObserver(req); ro.observe(canvas.parentElement) }
    // Scene content that changes outside React state
    const unsub: (() => void)[] = []
    const add = (ev: Cesium.Event | undefined) => { if (ev) { const r = ev.addEventListener(req); unsub.push(r) } }
    add(v.scene.imageryLayers.layerAdded); add(v.scene.imageryLayers.layerRemoved)
    add(v.scene.imageryLayers.layerMoved); add(v.scene.imageryLayers.layerShownOrHidden)
    add(v.dataSources.dataSourceAdded); add(v.dataSources.dataSourceRemoved)
    add(v.entities.collectionChanged)
    add(scene.globe.tileLoadProgressEvent)
    req()
    return () => {
      dom.forEach(([t, n, f, o]) => t.removeEventListener(n, f, o))
      ro?.disconnect()
      unsub.forEach((u) => { try { u() } catch { /* viewer already destroyed */ } })
    }
  }, [viewer])
}

/** Request one frame after every React commit of the calling component (slider, toggle, measurement edits, layers). */
export function useRenderAfterCommit(viewer: Cesium.Viewer | null): void {
  useEffect(() => {
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
  })
}

const renderUntil = new WeakMap<Cesium.Viewer, number>()
/** Ask for a frame on every animation frame for the next `ms`. Cesium needs a few frames to finish some changes (globe imagery
 *  after show/hide or reorder) and in request-render mode it would otherwise draw only the first. Overlapping calls share one loop. */
export function requestRenderFor(v: Cesium.Viewer, ms: number): void {
  if (v.isDestroyed()) return
  const running = renderUntil.has(v)
  renderUntil.set(v, Math.max(renderUntil.get(v) ?? 0, performance.now() + ms))
  if (running) return
  const tick = () => {
    if (v.isDestroyed()) { renderUntil.delete(v); return }
    v.scene.requestRender()
    if (performance.now() < (renderUntil.get(v) ?? 0)) requestAnimationFrame(tick)
    else renderUntil.delete(v)
  }
  requestAnimationFrame(tick)
}
