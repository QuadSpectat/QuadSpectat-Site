/**
 * Reference grid ("Grid / רשת"): a flat, world-space grid on a horizontal plane at the model's base, drawn by one fragment
 * shader on a single quad. INDICATIVE only: it is a scale and levelness aid, not a survey grid, and its lines are NOT
 * coordinates (they are local east/north metres counted from the middle of the model, not ITM or any official grid).
 *
 * - Lines are generated per pixel in LOCAL east/north metres (float-safe far from the Earth's centre) at decade spacings
 *   0.1 / 1 / 10 / 100 / 1000 m. Each level fades in when its cells are wider than a few screen pixels and the coarser
 *   levels take over, so the grid is Blender-style: it always shows 1-2 readable levels at any zoom, without popping.
 * - Fades out with distance from the camera (radius follows the model size and the viewing distance).
 * - Not pickable, writes no depth (measuring / Cesium's pickPosition never see it), polygon offset towards the camera so
 *   it does not z-fight with a ground surface lying exactly in the plane, but taller things still hide it.
 * - Switched off while red/cyan 3D is on (see CesiumViewer); the choice is remembered per device (`qs.grid`).
 */
import { useSyncExternalStore } from 'react'
import * as Cesium from 'cesium'

export const GRID_LEVELS = [0.1, 1, 10, 100, 1000]   // metres, decade ladder; the readout is one of these
export const GRID_EXTENT = 4000                       // half-size of the quad, metres
export const GRID_MIN_CELL_PX = 12                    // a level counts as "clearly visible" at this cell size (it is fully faded in)

/** The readout spacing for a given metres-per-pixel at the view centre: the finest decade whose cells are at least GRID_MIN_CELL_PX wide. */
export function gridSpacing(metresPerPixel: number): number {
  for (const s of GRID_LEVELS) if (s / metresPerPixel >= GRID_MIN_CELL_PX) return s
  return GRID_LEVELS[GRID_LEVELS.length - 1]
}

export function formatSpacing(m: number): string {
  if (m < 1) return `${Math.round(m * 100)} cm`
  if (m >= 1000) return `${m / 1000} km`
  return `${m} m`
}

/** Fade radius (metres) from the model size and the camera distance. Beyond ~3.5 km the grid is simply out of range. */
export function gridFadeRadius(modelRadius: number, camDistance: number): number {
  return Math.min(3500, Math.max(80, 4 * modelRadius, 2 * camDistance))
}

// ── small store: the panel and the viewer share it (no prop drilling). On/off and colour are remembered per device. ──
export const GRID_COLORS: { id: string; hex: string; he: string; en: string }[] = [
  { id: 'mint', hex: '#d1e6c7', he: 'ירקרק', en: 'Light green' },
  { id: 'white', hex: '#ffffff', he: 'לבן', en: 'White' },
  { id: 'black', hex: '#000000', he: 'שחור', en: 'Black' },
  { id: 'brand', hex: '#9acd3c', he: 'ירוק', en: 'Brand green' },
  { id: 'grey', hex: '#808080', he: 'אפור', en: 'Grey' },
]
export interface GridState { on: boolean; color: string; height: number }
const KEY = 'qs.grid'
const HEX = /^#[0-9a-f]{6}$/i

function readStored(): Pick<GridState, 'on' | 'color'> {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { on?: unknown; color?: unknown }
    return { on: j.on === true, color: typeof j.color === 'string' && HEX.test(j.color) ? j.color.toLowerCase() : GRID_COLORS[0].hex }
  } catch { return { on: false, color: GRID_COLORS[0].hex } }
}

let state: GridState = { ...readStored(), height: 0 }   // height (m above the model base) is per session, like the Height Offset slider
const subs = new Set<() => void>()
export function getGrid(): GridState { return state }
export function setGrid(patch: Partial<GridState>): void {
  state = { ...state, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify({ on: state.on, color: state.color })) } catch { /* private mode: not remembered */ }
  subs.forEach((f) => f())
}
export function useGridState(): GridState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state, () => state)
}

let readout = ''
const rsubs = new Set<() => void>()
function setReadout(t: string) { if (t !== readout) { readout = t; rsubs.forEach((f) => f()) } }
export function useGridReadout(): string {
  return useSyncExternalStore((f) => { rsubs.add(f); return () => { rsubs.delete(f) } }, () => readout, () => '')
}

const SHADER = `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  vec2 p = materialInput.st;
  float a = 0.0;
  float lv[5];
  lv[0] = 0.1; lv[1] = 1.0; lv[2] = 10.0; lv[3] = 100.0; lv[4] = 1000.0;
  for (int i = 0; i < 5; i++) {
    float s = lv[i];
    vec2 g = p / s;
    vec2 fw = max(fwidth(g), vec2(1e-7));
    float cellPx = 1.0 / max(fw.x, fw.y);                 // screen pixels per cell here (small near the horizon)
    float vis = smoothstep(4.0, ${GRID_MIN_CELL_PX}.0, cellPx);
    vec2 d = abs(fract(g - 0.5) - 0.5) / fw;               // distance to the nearest line, in pixels
    float line = 1.0 - min(min(d.x, d.y), 1.0);
    a = max(a, line * vis * (0.30 + 0.10 * float(i)));
  }
  float dist = length(vec3(p, 0.0) - u_cam);
  a *= 1.0 - smoothstep(0.45 * u_R, u_R, dist);
  if (u_cam.z < 0.0) a *= 0.4;                              // seen from below: dimmer, reads as "under the model"
  m.diffuse = u_color.rgb;
  m.alpha = a;
  return m;
}`

export interface GridAnchor {
  /** Middle of the model (ground point below it is the grid origin) */
  lon: number
  lat: number
  /** Ellipsoidal height of the plane, metres */
  h: number
  /** Model radius, metres (sets the fade radius) */
  radius: number
}

export interface GridFloor {
  setAnchor(a: GridAnchor): void
  /** Line colour, '#rrggbb' */
  setColor(hex: string): void
  destroy(): void
}

/** Adds the grid to the viewer. Call setAnchor once the model is ready and again when it moves; destroy() removes everything. */
export function createGridFloor(v: Cesium.Viewer): GridFloor {
  const scene = v.scene
  const e = GRID_EXTENT
  const geometry = new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3,
        values: new Float64Array([-e, -e, 0, e, -e, 0, e, e, 0, -e, e, 0]),
      }),
      st: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2,
        values: new Float32Array([-e, -e, e, -e, e, e, -e, e]),   // st = local east / north in METRES
      }),
    } as unknown as Cesium.GeometryAttributes,
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, e * 1.5),
  })

  let anchor: GridAnchor | null = null
  let mm = Cesium.Matrix4.IDENTITY.clone()
  let inv = Cesium.Matrix4.IDENTITY.clone()
  const camLocal = new Cesium.Cartesian3()
  let R = 100
  const material = new Cesium.Material({
    fabric: {
      type: 'QsGrid',
      uniforms: {
        u_cam: new Cesium.Cartesian3(),
        u_R: 100,
        u_color: Cesium.Color.fromCssColorString(state.color),
      },
      source: SHADER,
    },
    translucent: true,
  })
  const prim = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: new Cesium.MaterialAppearance({
      material, translucent: true, flat: true, faceForward: false, closed: false,
      renderState: {
        depthTest: { enabled: true },
        depthMask: false,
        cull: { enabled: false },
        blending: Cesium.BlendingState.ALPHA_BLEND,
        polygonOffset: { enabled: true, factor: -2, units: -2 },
      },
    }),
    asynchronous: false, allowPicking: false, releaseGeometryInstances: true, compressVertices: false,
    show: false,
  })
  scene.primitives.add(prim)

  const tmp = new Cesium.Cartesian3()
  const plane = new Cesium.Plane(Cesium.Cartesian3.UNIT_Z, 0)
  const ray = new Cesium.Ray()
  const localRay = new Cesium.Ray()   // the view-centre ray in the grid's local frame (reused every frame, no garbage)
  const hit = new Cesium.Cartesian3()
  const win = new Cesium.Cartesian2()
  let lastKey = ''
  // Cesium writes gl_FragDepth (log depth), which switches polygon offset off, so a surface lying exactly in the plane would
  // z-fight with the grid. Instead the plane is lifted a hair above the base, in proportion to the viewing distance.
  let lift = 0.02
  const place = () => {
    if (!anchor) return
    const origin = Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, anchor.h + lift)
    mm = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
    inv = Cesium.Matrix4.inverseTransformation(mm, new Cesium.Matrix4())
    prim.modelMatrix = mm
    scene.requestRender()
  }
  const onPre = () => {
    if (!anchor) { prim.show = false; return }
    prim.show = true
    const want = Math.min(1.5, Math.max(0.02, Cesium.Cartesian3.distance(v.camera.positionWC, Cesium.Matrix4.getTranslation(mm, tmp)) * 0.0006))
    if (want > lift * 1.15 || want < lift / 1.15) { lift = want; place() }
    // camera in the grid's local frame (small numbers: the shader fades by distance in float precision)
    Cesium.Matrix4.multiplyByPoint(inv, v.camera.positionWC, camLocal)
    const camDist = Math.hypot(camLocal.x, camLocal.y, camLocal.z)
    R = gridFadeRadius(anchor.radius, camDist)
    const u = material.uniforms as { u_cam: Cesium.Cartesian3; u_R: number }
    Cesium.Cartesian3.clone(camLocal, u.u_cam)
    u.u_R = R
    // readout: spacing at the view centre (ray from the screen middle onto the plane; else the distance to the model)
    const fovy = (v.camera.frustum as Cesium.PerspectiveFrustum).fovy ?? Cesium.Math.toRadians(60)
    let d = camDist
    win.x = v.canvas.clientWidth / 2; win.y = v.canvas.clientHeight / 2
    if (v.camera.getPickRay(win, ray)) {
      Cesium.Matrix4.multiplyByPoint(inv, ray.origin, localRay.origin)
      Cesium.Matrix4.multiplyByPointAsVector(inv, ray.direction, localRay.direction)
      const t = Cesium.IntersectionTests.rayPlane(localRay, plane, hit)
      if (t) d = Cesium.Cartesian3.distance(localRay.origin, t)
    }
    const mpp = (2 * d * Math.tan(fovy / 2)) / Math.max(1, scene.drawingBufferHeight)
    const key = camDist > R * 1.05 ? '—' : formatSpacing(gridSpacing(mpp))
    if (key !== lastKey) { lastKey = key; setReadout(key) }
  }
  scene.preRender.addEventListener(onPre)

  return {
    setAnchor(a) {
      const moved = !anchor || Math.abs(a.h - anchor.h) > 0.01 || Math.abs(a.lon - anchor.lon) > 1e-8 || Math.abs(a.lat - anchor.lat) > 1e-8
      anchor = a
      if (moved) place()
    },
    setColor(hex) {
      ;(material.uniforms as { u_color: Cesium.Color }).u_color = Cesium.Color.fromCssColorString(hex)
      scene.requestRender()
    },
    destroy() {
      scene.preRender.removeEventListener(onPre)
      if (!v.isDestroyed()) { scene.primitives.remove(prim); scene.requestRender() }
      setReadout('')
    },
  }
}
