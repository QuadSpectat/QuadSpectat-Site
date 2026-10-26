/**
 * Red/cyan anaglyph 3D: settings store, texts, shader and the depth maths. A presentation aid only (INDICATIVE):
 * nothing here is for measuring. The Cesium side lives in hooks/useStereo.ts.
 *
 * "On" is never saved (every visit starts flat); depth, eye distance, swap and look are remembered in `qs.stereo`.
 */
import { useSyncExternalStore } from 'react'
import { setSseBoost } from '@/lib/deviceProfile'

export interface StereoSettings {
  /** Multiplier of the automatic eye separation, 0 (flat) to 1.5 */
  depth: number
  /** true = separation is automatic (focus distance / 30 x depth); false = `eye` is used directly */
  auto: boolean
  /**
   * Manual eye separation as PERCENT OF THE VIEWING DISTANCE (distance to the zero-parallax plane). Chosen over
   * millimetres or % of model size because it keeps the depth feel the same while zooming and orbiting, and the
   * automatic value is then simply "3.3 %" (1/30), so the owner can compare the two directly.
   */
  eye: number
  /** Exchange which eye feeds the red and the cyan channel (glasses worn the other way round) */
  swap: boolean
  /** false = Colour (Dubois matrices), true = Comfort (half-colour, less rivalry) */
  comfort: boolean
}

export interface StereoState extends StereoSettings {
  on: boolean
  /** Why 3D cannot be used right now (the button is disabled with this reason) */
  blocked: null | 'google' | 'nomodel'
  /** On, but waiting because a measure / profile / geopoint tool is active */
  paused: boolean
  /** An orthophoto or base map is visible: they render flat in 3D */
  flatMap: boolean
  /** Phones: multiplier on the tileset screen-space error while 3D is on */
  boost: number
}

export const DEFAULT_STEREO: StereoSettings = { depth: 1, auto: true, eye: 100 / 30, swap: false, comfort: false }
export const EYE_MIN = 0.5, EYE_MAX = 6   // percent of viewing distance (Bourke: 1/30 = 3.3 %, upper limit 1/20 = 5 %)

const KEY = 'qs.stereo'

function readStored(): StereoSettings {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<StereoSettings>
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d)
    return {
      depth: num(j.depth, 0, 1.5, DEFAULT_STEREO.depth),
      auto: typeof j.auto === 'boolean' ? j.auto : DEFAULT_STEREO.auto,
      eye: num(j.eye, EYE_MIN, EYE_MAX, DEFAULT_STEREO.eye),
      swap: j.swap === true,
      comfort: j.comfort === true,
    }
  } catch { return { ...DEFAULT_STEREO } }
}

let state: StereoState = { ...readStored(), on: false, blocked: null, paused: false, flatMap: false, boost: 1 }
const listeners = new Set<() => void>()

export function getStereo(): StereoState { return state }

export function setStereo(patch: Partial<StereoState>): void {
  state = { ...state, ...patch }
  if ('boost' in patch) setSseBoost(state.boost)
  const keep: (keyof StereoSettings)[] = ['depth', 'auto', 'eye', 'swap', 'comfort']
  if (keep.some((k) => k in patch)) {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, state[k]])))) } catch { /* private mode */ }
  }
  listeners.forEach((l) => l())
}

export function useStereoState(): StereoState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => state, () => state)
}

// ── Texts: Hebrew first, English second, shown together ──────────────────────
export const T = {
  title: { he: 'משקפי תלת-ממד', en: '3D glasses' },
  on: { he: 'פועל', en: 'On' },
  off: { he: 'כבוי', en: 'Off' },
  paused: { he: 'מושהה', en: 'Paused' },
  depth: { he: 'עומק', en: 'Depth' },
  eye: { he: 'מרחק עיניים', en: 'Eye distance' },
  auto: { he: 'אוטומטי', en: 'Auto' },
  ofDistance: { he: 'מהמרחק', en: 'of distance' },
  swap: { he: 'החלף עיניים', en: 'Swap eyes' },
  test: { he: 'תמונת בדיקה', en: 'Test image' },
  look: { he: 'מראה', en: 'Look' },
  colour: { he: 'צבע', en: 'Colour' },
  comfort: { he: 'נוחות', en: 'Comfort' },
  close: { he: 'סגור', en: 'Close' },
  google: { he: 'לא זמין ל-Google 3D', en: 'Not available for Google 3D' },
  nomodel: { he: 'זמין רק למודלים תלת-ממדיים', en: '3D models only' },
  flat: { he: 'אורתופוטו ומפה מוצגים שטוחים בתלת-ממד', en: 'Orthophoto and map appear flat in 3D' },
  phone: { he: 'עובד הכי טוב על מסך מחשב. בטלפון זה עשוי להיות איטי או לא חד. סובבו לרוחב.', en: 'Works best on a computer screen. On a phone it may be slow or soft. Rotate to landscape.' },
  safety: {
    he: 'תצוגה להצגה בלבד, לא למדידה. קחו הפסקות; הפסיקו אם יש אי-נוחות, כאב ראש או סחרחורת. לא מתאים למי שאין לו ראיית עומק בשתי העיניים.',
    en: 'Presentation view, not for measuring. Take breaks; stop if you feel discomfort, headache or dizziness. Not for people without 3D vision in both eyes.',
  },
  lensLeft: { he: 'עדשה אדומה על העין השמאלית.', en: 'Red lens on the LEFT eye.' },
  lensRight: { he: 'עדשה אדומה על העין הימנית.', en: 'Red lens on the RIGHT eye.' },
  pausedMeasure: { he: 'משקפי התלת-ממד מושהים בזמן מדידה', en: '3D glasses paused while measuring' },
  resumed: { he: 'משקפי התלת-ממד חזרו', en: '3D glasses back on' },
  slow: { he: 'איטי במכשיר הזה. הפרטים הופחתו.', en: 'Slow on this device. Reduced detail.' },
  tooSlow: { he: 'כובה: איטי מדי במכשיר הזה', en: '3D glasses turned off: too slow on this device' },
  googleOff: { he: 'משקפי התלת-ממד כובו: לא זמין ל-Google 3D', en: '3D glasses turned off: not available for Google 3D' },
  testPatches: {
    he: 'עצמו עין ימין: הריבוע האדום צריך להיות בהיר והציאן כהה. עצמו עין שמאל: ההפך.',
    en: 'Close the right eye: the red patch should look bright and the cyan one dark. Close the left eye: the opposite.',
  },
  testPatchesSwapped: {
    he: 'עצמו עין שמאל: הריבוע האדום צריך להיות בהיר והציאן כהה. עצמו עין ימין: ההפך.',
    en: 'Close the left eye: the red patch should look bright and the cyan one dark. Close the right eye: the opposite.',
  },
  testFloat: {
    he: 'הריבוע צריך לצוף לפני הדף. אם הוא שוקע מאחוריו, לחצו על "החלף עיניים".',
    en: 'The square should float IN FRONT of the page. If it sinks behind it, press Swap eyes.',
  },
} as const
export type TextKey = keyof typeof T
export const bi = (k: TextKey): string => `${T[k].he} / ${T[k].en}`

// ── Depth maths (pure) ───────────────────────────────────────────────────────
const AUTO_EYE = 1 / 30        // Bourke's rule of thumb: eye separation = zero-parallax distance / 30
const MAX_PARALLAX = 0.0262    // 1.5 degrees in radians: keep the model's own depth range under this

/** Zero-parallax distance (m): a little in front of the model centre so most of the model sits at or behind the screen. */
export function focusDistance(cameraToCentre: number, radius: number): number {
  return Math.max(cameraToCentre - 0.5 * radius, 2)
}

/**
 * Eye separation (m) for focus distance D and a model of the given radius. Automatic: D/30 x depth, then reduced so the
 * model's near and far parallax stay under 1.5 degrees (the ground and horizon beyond the model are ignored on purpose).
 * Manual: exactly `eye` percent of D; the owner chose it, so it is not clamped.
 */
export function eyeSeparation(D: number, radius: number, s: Pick<StereoSettings, 'depth' | 'auto' | 'eye'>): number {
  if (!s.auto) return (D * s.eye) / 100
  const e = D * AUTO_EYE * s.depth
  const near = Math.max(D - radius, 0.3 * D), far = D + radius
  const theta = e * Math.max(1 / near - 1 / D, 1 / D - 1 / far)
  return theta > MAX_PARALLAX ? (e * MAX_PARALLAX) / theta : e
}

/**
 * Phone frame-rate guard. Feed it the time between consecutive frames of a continuous run (camera moving); idle gaps
 * are not measured. Median over 2 s above 50 ms: 'reduce' (less detail, once). Still above 66 ms 4 s later: 'off'.
 */
export function createFrameGuard() {
  let samples: { t: number; dt: number }[] = []
  let reducedAt = 0
  return {
    push(dt: number, now: number): 'ok' | 'reduce' | 'off' {
      samples.push({ t: now, dt })
      while (samples.length && samples[0].t < now - 2000) samples.shift()
      if (samples.length < 6 || now - samples[0].t < 1500) return 'ok'
      const sorted = samples.map((s) => s.dt).sort((a, b) => a - b)
      const median = sorted[sorted.length >> 1]
      if (!reducedAt) {
        if (median <= 50) return 'ok'
        reducedAt = now; samples = []
        return 'reduce'
      }
      return now - reducedAt >= 4000 && median > 66 ? 'off' : 'ok'
    },
  }
}

// ── Shader: merges the two half-width eye images into one red/cyan image ──
// Cesium draws the RIGHT eye (camera moved right) into the LEFT half and the LEFT eye into the RIGHT half.
// Cesium 1.141 loses its own convergence offset (PerspectiveFrustum.clone drops xOffset), so the zero-parallax plane is
// made here: each half is shifted sideways by u_shift (fraction of the screen width) so that points at the focus distance coincide.
// Dubois least-squares matrices (as in three.js AnaglyphEffect, MIT): out = ML * left + MR * right.
// Comfort = half-colour: red from the left eye's luminance, green and blue from the right eye.
// Fixed gain 1.15 because anaglyph is dark; the existing Exposure slider stays for fine tuning.
export const ANAGLYPH_SHADER = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform vec2 u_px;
uniform float u_shift;
uniform float u_swap;
uniform float u_comfort;
const mat3 ML = mat3(0.456100, -0.0400822, -0.0152161, 0.500484, -0.0378246, -0.0205971, 0.176381, -0.0157589, -0.00546856);
const mat3 MR = mat3(-0.0434706, 0.378476, -0.0721527, -0.0879388, 0.73364, -0.112961, -0.00155529, -0.0184503, 1.2264);
void main() {
    vec2 uv = v_textureCoordinates;
    // each eye is squeezed to half the width: stretch it back, staying inside its own half
    vec3 a = texture(colorTexture, vec2(clamp((uv.x - u_shift) * 0.5, 0.0, 0.5 - 0.5 * u_px.x), uv.y)).rgb;           // right eye, moves right
    vec3 b = texture(colorTexture, vec2(clamp(0.5 + (uv.x + u_shift) * 0.5, 0.5 + 0.5 * u_px.x, 1.0), uv.y)).rgb;   // left eye, moves left
    vec3 L = mix(b, a, u_swap);
    vec3 R = mix(a, b, u_swap);
    vec3 o = u_comfort > 0.5 ? vec3(dot(L, vec3(0.299, 0.587, 0.114)), R.g, R.b) : ML * L + MR * R;
    out_FragColor = vec4(clamp(o * 1.15, 0.0, 1.0), 1.0);
}
`
