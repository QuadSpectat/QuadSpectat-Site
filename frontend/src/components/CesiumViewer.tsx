import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { prepareGlb } from '@/lib/glbNormalize'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// Disable Ion so Cesium doesn't attempt Ion network calls without a token
Cesium.Ion.defaultAccessToken = ''
import { useMeasure } from '@/hooks/useMeasure'
import { Chrome } from '@/components/Chrome'
import { useStereo } from '@/hooks/useStereo'
import { useStereoState } from '@/lib/anaglyph'
import { useGridFloor } from '@/hooks/useGridFloor'
import { useGeopoints } from '@/hooks/useGeopoints'
import { ProfilePanel } from '@/components/ProfilePanel'
import type { Profile } from '@/lib/profile'
import type { Model } from '@/lib/api'
import type { MeasureMode } from '@/lib/measure'
import type { VisualSettings } from '@/lib/visualControls'
import { DEFAULT_VISUAL, qualityToSSE } from '@/lib/visualControls'
import type { BaseMap } from '@/components/MapSwitcher'
import type { GeoPoint } from '@/lib/geopoints'
import type { HeightRef } from '@/lib/heights'
import { modelGeoidShift, modelCoordinateSystem } from '@/lib/heights'
import type { ViewApi } from '@/lib/views'
import { OrientationAids } from '@/components/OrientationAids'
import { effectiveSse, tilesetMemoryOptions, setQualityMode } from '@/lib/deviceProfile'
import { usePerformanceProfile } from '@/hooks/usePerformanceProfile'
import { useRenderOnDemand, useRenderAfterCommit, continuousRenderRequested, requestRenderFor } from '@/hooks/useRenderOnDemand'
import { useContextLoss } from '@/hooks/useContextLoss'
import { takeEarlyTileset } from '@/lib/earlyModel'
import { GpuNoticeCard } from '@/components/GpuNoticeCard'
import { LayerFeatureCard } from '@/components/LayerFeatureCard'
import type { FeaturePick } from '@/components/LayerFeatureCard'
import {
  loadLayerDataSource, nameDataSource, applyVisibility, captureOrigins, applyLayerOffset, drapePoints, drapeOnModel, describeEntity,
} from '@/lib/layerRender'
import type { EntityOrigin } from '@/lib/layerRender'

// ── Height-offset helper ─────────────────────────────────────────────────────
// Translates a tileset vertically by `metres` along the ellipsoid normal at
// the tileset centre. Used to correct the ITM orthometric → WGS84 ellipsoidal
// height difference (~17–18 m in Israel).
function applyHeightOffset(tileset: Cesium.Cesium3DTileset, metres: number): void {
  const cart = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center)
  const surface = Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, 0)
  const offset  = Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, metres)
  const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3())
  tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation)
}

// ── First-view framing ───────────────────────────────────────────────────────
// The root bounding sphere of a photogrammetry tileset is far bigger than the model, which is why zoomTo(tileset)
// framed it off-centre and cropped. Use the union of the first-level child spheres (the real content) and size the
// camera distance from the NARROW field of view, so portrait phones fit the whole model too.
function contentSphere(tileset: Cesium.Cesium3DTileset, shift: Cesium.Cartesian3): Cesium.BoundingSphere {
  const kids = tileset.root?.children ?? []
  const spheres: Cesium.BoundingSphere[] = []
  for (const k of kids) {
    const bs = k.boundingSphere
    if (bs && Number.isFinite(bs.radius) && bs.radius > 0) {
      spheres.push(new Cesium.BoundingSphere(Cesium.Cartesian3.add(bs.center, shift, new Cesium.Cartesian3()), bs.radius))
    }
  }
  if (spheres.length === 0) return tileset.boundingSphere.clone()
  return Cesium.BoundingSphere.fromBoundingSpheres(spheres)
}

function frameOffset(v: Cesium.Viewer, sphere: Cesium.BoundingSphere): Cesium.HeadingPitchRange {
  const f = v.camera.frustum as Cesium.PerspectiveFrustum
  const aspect = v.canvas.clientWidth > 0 && v.canvas.clientHeight > 0 ? v.canvas.clientWidth / v.canvas.clientHeight : 1
  const fovy = f.fovy ?? Cesium.Math.toRadians(60)
  const fovx = 2 * Math.atan(Math.tan(fovy / 2) * aspect)
  const narrow = Math.min(fovx, fovy)
  const range = (sphere.radius / Math.sin(narrow / 2)) * 1.05
  return new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), range)
}

// ── Color-correction post-process shader ────────────────────────────────────
const COLOR_CORRECTION_SHADER = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
void main() {
    vec4 raw = texture(colorTexture, v_textureCoordinates);
    vec3 c = raw.rgb;
    c *= pow(2.0, u_exposure);
    c += u_brightness;
    c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, 1.0 + u_saturation);
    c.r += u_temperature * 0.1;
    c.b -= u_temperature * 0.1;
    out_FragColor = vec4(clamp(c, 0.0, 1.0), raw.a);
}
`

import type { ResolvedLayer, LayerLoadState } from '@/components/LayerPanel'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'
import type { OrthoCompare } from '@/components/ComparePanel'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

import React from 'react'

interface Props {
  selectedModel: Model | null
  modelUrl: string | null
  measureMode: MeasureMode
  baseElevation: number
  measureKey: number
  onMeasureResult: (text: string | null) => void
  visualSettings?: VisualSettings
  baseMap?: BaseMap
  /** Google Photorealistic 3D Tiles are owner-only: ignored (falls back to OSM) unless true. */
  allowGoogle3d?: boolean
  /** Called when Google 3D could not load, so the parent can restore the previous base map. */
  onBaseMapFallback?: () => void
  layers?: ResolvedLayer[]
  /** Reports each layer's load result so the panel can show errors (and the owner can retry) */
  onLayerState?: (id: string, state: LayerLoadState) => void
  orthophotos?: ResolvedOrthophoto[]
  /** Set on shared / client pages: authorises tile requests for that one orthophoto. */
  shareToken?: string
  /** Overlay model for time-comparison crossfade */
  overlayModel?: Model | null
  overlayModelUrl?: string | null
  /** 0 = base only, 1 = overlay only */
  compareBlend?: number
  /** Orthophoto before/after compare state */
  orthoCompare?: OrthoCompare | null
  /** How the compare is shown: cross-fade (default) or a draggable swipe line */
  compareMode?: 'fade' | 'swipe'
  /** Swipe line position, 0 (left edge) to 1 (right edge) of the map */
  swipePos?: number
  onSwipePosChange?: (pos: number) => void
  /** Called with the detected geoid offset (m) when user snaps to ground */
  onSnapToGround?: (detectedOffset: number) => void
  /** Parent passes a ref; CesiumViewer writes the snap-to-ground function into it */
  snapRef?: React.MutableRefObject<(() => void) | null>
  /** Parent passes a ref; CesiumViewer writes the reset-camera function into it */
  resetCameraRef?: React.MutableRefObject<(() => void) | null>
  /** Parent passes a ref; CesiumViewer writes the fly-to-orthophoto function into it */
  flyToOrthoRef?: React.MutableRefObject<((photo: ResolvedOrthophoto) => void) | null>
  geopointActive?: boolean
  geopoints?: GeoPoint[]
  onGeopointAdd?: (pt: GeoPoint) => void
  /** Parent passes a ref; CesiumViewer writes capture/flyTo for saved camera views into it */
  viewApiRef?: React.MutableRefObject<ViewApi | null>
  /** Parent passes a ref; CesiumViewer's measure tool writes its undo function into it */
  undoRef?: React.MutableRefObject<(() => void) | null>
  /** Same, for Redo */
  redoRef?: React.MutableRefObject<(() => void) | null>
  /** Same, for the touch "Finish" button (completes the measurement without a double-click) */
  finishRef?: React.MutableRefObject<(() => void) | null>
}

/** One drawn layer: the data source, the settings it was built with, and the offset currently applied to it. */
interface LayerRuntime {
  ds: Cesium.DataSource
  /** url + placement + reload counter: a change means the file must be loaded again */
  key: string
  offset: number
  visible: boolean
  origins: Map<string, EntityOrigin>
}

function CesiumViewerInner({
  onRecover,
  selectedModel, modelUrl,
  measureMode, baseElevation, measureKey, onMeasureResult,
  visualSettings = DEFAULT_VISUAL,
  baseMap: requestedBaseMap = 'none',
  allowGoogle3d = false,
  onBaseMapFallback,
  layers = [],
  onLayerState,
  orthophotos = [],
  shareToken,
  overlayModel = null,
  overlayModelUrl = null,
  compareBlend = 0.5,
  orthoCompare = null,
  compareMode = 'fade',
  swipePos = 0.5,
  onSwipePosChange,
  onSnapToGround,
  snapRef,
  resetCameraRef,
  flyToOrthoRef,
  geopointActive = false,
  geopoints = [],
  onGeopointAdd,
  viewApiRef,
  undoRef,
  redoRef,
  finishRef,
}: Props & { onRecover: () => void }) {
  // Never show Google tiles unless the page explicitly allows it (share/client links don't)
  const baseMap: BaseMap = requestedBaseMap === 'google3d' && !allowGoogle3d ? 'osm' : requestedBaseMap
  const googleShown = baseMap === 'google3d'
  const fallbackRef = useRef(onBaseMapFallback)
  fallbackRef.current = onBaseMapFallback
  const containerRef  = useRef<HTMLDivElement>(null)
  const creditRef     = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Cesium.Viewer | null>(null)
  const entityRef    = useRef<Cesium.Entity | null>(null)
  const tilesetRef   = useRef<Cesium.Cesium3DTileset | null>(null)
  // Everything the viewer knows about each drawn layer (see the sync effect further down)
  const layerRtRef = useRef<Map<string, LayerRuntime>>(new Map())
  // Layer id → key of the load in flight (a changed key makes a running load stale)
  const layerLoadingRef = useRef<Map<string, string>>(new Map())
  const onLayerStateRef = useRef(onLayerState)
  onLayerStateRef.current = onLayerState
  const layersRef = useRef(layers)
  layersRef.current = layers
  // Tracked base-map imagery layer (so we can swap without removeAll)
  const baseLayerRef    = useRef<Cesium.ImageryLayer | null>(null)
  // Google Photorealistic 3D Tiles primitive (basemap alternative)
  const google3dRef     = useRef<Cesium.Cesium3DTileset | null>(null)
  // Map from orthophoto id → Cesium ImageryLayer
  const orthoLayerRef   = useRef<Map<string, Cesium.ImageryLayer>>(new Map())
  // Overlay model for time-comparison
  const overlayEntityRef  = useRef<Cesium.Entity | null>(null)
  const overlayTilesetRef = useRef<Cesium.Cesium3DTileset | null>(null)
  // Bounding sphere of the open model: red/cyan 3D takes its focus distance and eye separation from it
  const stereoSphereRef = useRef<Cesium.BoundingSphere | null>(null)
  // True once the open glTF model can be sampled for heights (layers are draped onto it only then)
  const modelReadyRef = useRef(false)
  const swipePosRef = useRef(swipePos)
  swipePosRef.current = swipePos

  // Keep a ref so shader uniform getters always read the latest values
  const visualRef = useRef<VisualSettings>(visualSettings)
  visualRef.current = visualSettings
  // What shift the model currently has, so measured heights can be converted to height above sea level
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  // Where a 3D Tiles model is (its middle), known once the tileset has loaded: the geoid height N is taken there
  const tileCenterRef = useRef<{ lat: number; lon: number } | null>(null)
  /** The vertical shift the open model is drawn with: geoid part (see modelGeoidShift) without the fine-tune slider */
  const geoidShiftOf = (m: Model | null | undefined): number => {
    if (!m) return 0
    if (m.model_type === '3d-tiles') return modelGeoidShift(m, tileCenterRef.current?.lat, tileCenterRef.current?.lon)
    return modelGeoidShift(m, m.latitude, m.longitude)
  }
  // Getters, so a measurement always sees the shift that is drawn right now (the tileset centre arrives after the first render)
  const heightRef = useRef<HeightRef>({ appliedOffset: 0 })
  heightRef.current = {
    get coordinateSystem() { return modelCoordinateSystem(selectedModelRef.current) },
    // exactly the vertical shift the model is drawn with
    get appliedOffset() { return geoidShiftOf(selectedModelRef.current) + visualRef.current.heightOffset },
  }

  // Exposed as state so useMeasure re-runs once the viewer is ready
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null)
  const [tileError, setTileError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  // "Loading 3D model..." while the model file is on its way (a blank globe looked like a failure on slow connections)
  const [loadingModel, setLoadingModel] = useState(false)
  const ccStageRef = useRef<Cesium.PostProcessStage | Cesium.PostProcessStageComposite | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  // Home button target — set wherever resetCameraRef is set
  const homeRef = useRef<(() => void) | null>(null)

  const onNotice = (msg: string) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(msg)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3000)
  }
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  // Snap-to-ground: reset model matrix, read native height, report to parent
  const snapToGround = () => {
    const tileset = tilesetRef.current
    if (!tileset || !onSnapToGround) return
    tileset.modelMatrix = Cesium.Matrix4.IDENTITY.clone()
    const cart = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center)
    // The ellipsoidal height at the centre IS the geoid error we need to remove
    const detectedOffset = -cart.height
    onSnapToGround(detectedOffset)
  }
  // Expose via ref so VisualControls button can call it without prop-drilling
  const snapToGroundRef = useRef(snapToGround)
  snapToGroundRef.current = snapToGround
  // Also write into parent-supplied ref
  if (snapRef) snapRef.current = snapToGround

  // Init
  useEffect(() => {
    if (!containerRef.current || !creditRef.current) return

    let v: Cesium.Viewer
    try {
    v = new Cesium.Viewer(containerRef.current, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      baseLayer: false,          // no default Ion imagery
      skyBox: false,             // no starfield
      skyAtmosphere: false,      // no atmosphere glow
      creditContainer: creditRef.current, // redirect credits to hidden element
      contextOptions: { webgl: { preserveDrawingBuffer: true } }, // needed for canvas.toDataURL()
      // Draw a frame only when something changed (idle phones stop burning battery). ?render=continuous restores the old loop.
      requestRenderMode: !continuousRenderRequested(),
      maximumRenderTimeChange: Infinity,
      showRenderLoopErrors: false,   // our own card handles render errors / lost contexts
    })
    } catch (err) {
      console.error('[CesiumViewer] Could not start WebGL', err)
      setStartError(err instanceof Error ? err.message : String(err))
      return
    }

    v.imageryLayers.removeAll()
    v.scene.backgroundColor = Cesium.Color.BLACK
    // Prevent the globe surface from occluding models placed at/near ground level
    v.scene.globe.depthTestAgainstTerrain = false

    // Add color-correction post-process stage
    // Uniform getters read from visualRef so values update every frame without
    // recreating the stage.
    ccStageRef.current = v.scene.postProcessStages.add(new Cesium.PostProcessStage({
      fragmentShader: COLOR_CORRECTION_SHADER,
      uniforms: {
        u_exposure:    () => visualRef.current.exposure,
        u_brightness:  () => visualRef.current.brightness,
        u_contrast:    () => visualRef.current.contrast,
        u_saturation:  () => visualRef.current.saturation,
        u_temperature: () => visualRef.current.temperature,
      },
    }))

    viewerRef.current = v
    setViewer(v)
    // Expose for diagnostics — type via window.__viewer in DevTools to inspect
    // imageryLayers, camera state, etc. Removed in production builds via tree-shaking
    // when not referenced, but cheap enough to leave on for now.
    ;(window as unknown as { __viewer: Cesium.Viewer }).__viewer = v

    if (viewApiRef) {
      viewApiRef.current = {
        capture: () => {
          const vv = viewerRef.current
          if (!vv || vv.isDestroyed()) return null
          const c = vv.camera.positionCartographic
          return {
            lon: Cesium.Math.toDegrees(c.longitude),
            lat: Cesium.Math.toDegrees(c.latitude),
            height: c.height,
            heading: vv.camera.heading,
            pitch: vv.camera.pitch,
            roll: vv.camera.roll,
          }
        },
        flyTo: (c) => {
          const vv = viewerRef.current
          if (!vv || vv.isDestroyed()) return
          vv.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(c.lon, c.lat, c.height),
            orientation: { heading: c.heading, pitch: c.pitch, roll: c.roll },
            duration: 1.5,
          })
        },
      }
    }

    if (flyToOrthoRef) {
      flyToOrthoRef.current = (photo: ResolvedOrthophoto) => {
        const vv = viewerRef.current
        if (!vv || photo.bounds_west == null) return
        vv.camera.flyTo({
          destination: Cesium.Rectangle.fromDegrees(
            photo.bounds_west, photo.bounds_south!, photo.bounds_east!, photo.bounds_north!,
          ),
          duration: 1.5,
        })
      }
    }

    return () => {
      v.destroy()
      viewerRef.current = null
      google3dRef.current = null
      overlayEntityRef.current = null
      overlayTilesetRef.current = null
      if (flyToOrthoRef) flyToOrthoRef.current = null
      if (viewApiRef) viewApiRef.current = null
      setViewer(null)
    }
  }, [])

  // Model loading
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    stereoSphereRef.current = null
    modelReadyRef.current = false
    tileCenterRef.current = null
    // Remove previous glTF entity
    if (entityRef.current) {
      v.entities.remove(entityRef.current)
      entityRef.current = null
    }
    // Remove previous 3D Tiles primitive
    if (tilesetRef.current) {
      v.scene.primitives.remove(tilesetRef.current)
      tilesetRef.current = null
    }

    setLoadingModel(false)
    if (!selectedModel || !modelUrl) return

    setTileError(null)
    setLoadingModel(true)

    // 3D Tiles path
    if (selectedModel.model_type === '3d-tiles') {
      let cancelled = false
      // Use direct Spaces URL (not CDN) to avoid CDN CORS cache issues
      const directUrl = modelUrl.replace(
        /([a-z0-9-]+)\.fra1\.cdn\.digitaloceanspaces\.com/,
        '$1.fra1.digitaloceanspaces.com',
      )
      // The root JSON may already be on its way (started while the engine downloaded): reuse it, never fetch twice.
      const early = takeEarlyTileset(directUrl)
      const rootResource = new Cesium.Resource({ url: directUrl })
      if (early) {
        const orig = Cesium.Resource.prototype.fetchJson
        rootResource.fetchJson = () => (early as Promise<any>).catch(() => orig.call(rootResource)) // eslint-disable-line @typescript-eslint/no-explicit-any
      }
      Cesium.Cesium3DTileset.fromUrl(rootResource, {
        maximumScreenSpaceError: effectiveSse(qualityToSSE(visualRef.current.quality)),
        ...tilesetMemoryOptions(),
      }).then((tileset) => {
        if (cancelled || !viewerRef.current) return
        setLoadingModel(false)
        const vv = viewerRef.current
        vv.scene.primitives.add(tileset)
        tilesetRef.current = tileset
        // Combined offset: model's stored geoid correction + user fine-tune slider
        const rootBefore = tileset.boundingSphere.center.clone()
        const c0 = Cesium.Cartographic.fromCartesian(rootBefore)
        tileCenterRef.current = { lat: Cesium.Math.toDegrees(c0.latitude), lon: Cesium.Math.toDegrees(c0.longitude) }
        applyHeightOffset(tileset, geoidShiftOf(selectedModel) + visualRef.current.heightOffset)
        const shift = Cesium.Cartesian3.subtract(tileset.boundingSphere.center, rootBefore, new Cesium.Cartesian3())
        const focus = contentSphere(tileset, shift)
        stereoSphereRef.current = focus
        // First view: set the camera immediately (no flight over a half-loaded scene); Home flies back to the same framing.
        vv.camera.viewBoundingSphere(focus, frameOffset(vv, focus))
        vv.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)   // viewBoundingSphere leaves the camera in the sphere's local frame
        vv.scene.requestRender()
        const fly = () => { if (viewerRef.current) viewerRef.current.camera.flyToBoundingSphere(focus, { duration: 1.2, offset: frameOffset(viewerRef.current, focus) }) }
        if (resetCameraRef) resetCameraRef.current = fly
        homeRef.current = fly
      }).catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[CesiumViewer] Failed to load 3D Tileset:', err)
          setLoadingModel(false)
          setTileError(msg)
        }
      })
      return () => { cancelled = true }
    }

    // glTF / GLB entity path
    const { longitude, latitude, altitude, heading, pitch, roll, scale } = selectedModel
    if (![longitude, latitude, altitude].every((n) => typeof n === 'number' && Number.isFinite(n))
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      const msg = 'This model has no valid position (longitude / latitude / altitude). Open Admin > Models > Edit and enter where it is.'
      setLoadingModel(false)
      setTileError(msg)
      const noop = () => onNotice(msg)
      if (resetCameraRef) resetCameraRef.current = noop
      homeRef.current = noop
      return
    }
    // The altitude is the sea-level height of the model's ground: the geoid offset (when switched on for this model) and the
    // Height Offset slider are added, like they are for 3D Tiles; the slider moves the model later (see the effect below)
    const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude + modelGeoidShift(selectedModel, latitude, longitude) + visualRef.current.heightOffset)
    const hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(heading),
      Cesium.Math.toRadians(pitch),
      Cesium.Math.toRadians(roll),
    )
    // Same CDN-CORS workaround as the tileset path: load from the origin host, not the CDN host
    const directUrl = modelUrl.replace(
      /([a-z0-9-]+)\.fra1\.cdn\.digitaloceanspaces\.com/,
      '$1.fra1.digitaloceanspaces.com',
    )

    let cancelled = false
    let timerRef: number | undefined
    let revoke: (() => void) | undefined
    const build = (uri: string) => {
      const entity = v.entities.add({
        name: selectedModel.name,
        position,
        orientation: new Cesium.ConstantProperty(
          Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
        ),
        model: {
          uri,
          scale,
          minimumPixelSize: 64,
          maximumScale: 200_000,
          shadows: Cesium.ShadowMode.ENABLED,
        },
      })

      entityRef.current = entity

      // Frame the real geometry once the model is ready (entity.flyTo can wait forever on a model that
      // never becomes ready, and frames a 2 m view for tiny models). Before it is ready (or if it never
      // is) Home still flies to the placement point instead of doing nothing.
      const bs = new Cesium.BoundingSphere()
      const modelReady = (): boolean => {
        const vv = viewerRef.current
        if (!vv || vv.isDestroyed() || !vv.dataSourceDisplay.ready) return false
        try {
          return (vv.dataSourceDisplay as unknown as {
            getBoundingSphere: (e: Cesium.Entity, allowPartial: boolean, r: Cesium.BoundingSphere) => number
          }).getBoundingSphere(entity, false, bs) === 0 && Number.isFinite(bs.radius)  // 0 = BoundingSphereState.DONE (not in the public typings)
        } catch { return false }  // visualizers not created yet on the first frames
      }
      const fly = () => {
        const vv = viewerRef.current
        if (!vv || vv.isDestroyed()) return
        if (modelReady()) {
          vv.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(bs.center.clone(), bs.radius),
            { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), Math.max(bs.radius * 3, 5)) },
          )
        } else {
          vv.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(position, 1),
            { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 60) },
          )
        }
      }
      fly()
      if (resetCameraRef) resetCameraRef.current = fly
      homeRef.current = fly

      // The 25 s are counted only while the tab is visible (a background tab draws no frames, so the model cannot get ready),
      // and the timer keeps running after the message: if the model does become ready, the message is taken back.
      const notReadyMsg = 'The model file was fetched but could not be displayed (still not ready after 25 s). Possible causes: the download was blocked (check the browser console / Spaces CORS), a texture or extension in the file is unsupported, or the geometry is invalid.'
      let visibleMs = 0
      const timer = window.setInterval(() => {
        if (cancelled) { window.clearInterval(timer); return }
        if (modelReady()) {
          window.clearInterval(timer)
          modelReadyRef.current = true
          setLoadingModel(false)
          setTileError((cur) => (cur === notReadyMsg ? null : cur))
          stereoSphereRef.current = new Cesium.BoundingSphere(bs.center.clone(), bs.radius)
          const far = Cesium.Cartesian3.distance(bs.center, position)
          if (far > 5000) {
            setTileError(`The model's geometry is ${(far / 1000).toFixed(0)} km away from its placement point (the file is not centred on its origin), so it is not drawn where you placed it. Re-export it centred, or use Edit to move the placement point.`)
          }
          fly()
        } else if (!document.hidden) {
          visibleMs += 300
          if (visibleMs > 25_000 && visibleMs <= 25_300) { setLoadingModel(false); setTileError(notReadyMsg) }
        }
      }, 300)
      timerRef = timer
    }
    // Normalise photogrammetry GLBs that carry a projected CESIUM_RTC centre (see glbNormalize.ts); others load as-is
    void prepareGlb(directUrl).then((r) => {
      if (cancelled) { r.revoke?.(); return }
      if (r.failed) {
        // The file is not there (or not allowed): say so now, keep Home working (it flies to the placement point)
        const st = r.failed.status
        setLoadingModel(false)
        setTileError(st === 404 || st === 410
          ? `The model file was not found (HTTP ${st}). It may have been moved or deleted: please contact QuadSpectat.`
          : st === 401 || st === 403
            ? `The model file could not be opened: access was refused (HTTP ${st}). The link may have expired: please contact QuadSpectat.`
            : `The model file could not be downloaded: the file server returned an error (HTTP ${st}). Please try again in a moment.`)
        const goHome = () => {
          const vv = viewerRef.current
          if (vv && !vv.isDestroyed()) vv.camera.flyToBoundingSphere(new Cesium.BoundingSphere(position, 1), { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 60) })
        }
        if (resetCameraRef) resetCameraRef.current = goHome
        homeRef.current = goHome
        goHome()
        return
      }
      revoke = r.revoke
      if (r.note) onNotice(r.note)
      build(r.url)
    })
    return () => { cancelled = true; if (timerRef) window.clearInterval(timerRef); revoke?.() }
  }, [selectedModel?.id, modelUrl])

  const googleFailed = (msg: string) => {
    onNotice(msg)
    fallbackRef.current?.()
  }

  // Swap base imagery layer when baseMap changes (does NOT remove orthophoto layers)
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    // Clear any stale basemap error
    setTileError(null)

    // Remove old base imagery layer
    if (baseLayerRef.current) {
      v.imageryLayers.remove(baseLayerRef.current, true)
      baseLayerRef.current = null
    }
    // Remove old Google 3D tileset and restore the globe
    if (google3dRef.current) {
      v.scene.primitives.remove(google3dRef.current)
      google3dRef.current = null
      v.scene.globe.show = true
    }

    if (baseMap === 'osm') {
      baseLayerRef.current = v.imageryLayers.addImageryProvider(
        new Cesium.OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/',
          credit: '© OpenStreetMap contributors',
        }),
        0,  // insert at bottom
      )
    } else if (baseMap === 'satellite') {
      baseLayerRef.current = v.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          credit: 'Esri World Imagery',
        }),
        0,  // insert at bottom
      )
    } else if (baseMap === 'google3d') {
      const key = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined
      if (!key) {
        googleFailed('Google 3D is not available (no API key set).')
      } else {
        Cesium.Cesium3DTileset.fromUrl(
          `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`,
          { showCreditsOnScreen: true },
        ).then((tileset) => {
          // Guard: user may have switched away while the async load was in flight
          if (viewerRef.current && baseMap === 'google3d') {
            // Google 3D provides its own terrain/ground — hide the Cesium globe
            // so it does not render on top of the photorealistic tiles
            viewerRef.current.scene.globe.show = false
            viewerRef.current.scene.primitives.add(tileset)
            google3dRef.current = tileset
            // HTTP errors while streaming (bad/expired key, quota): fall back once
            let failed = false
            tileset.tileFailed.addEventListener(() => {
              if (failed) return
              failed = true
              googleFailed('Google 3D stopped loading (key or quota problem). Showing the previous base map.')
            })
          } else {
            tileset.destroy()
          }
        }).catch((err: unknown) => {
          console.error('Google 3D failed', err)
          if (viewerRef.current && baseMap === 'google3d') googleFailed('Google 3D could not be loaded. Showing the previous base map.')
        })
      }
    }
    // 'none' → base layer already removed
  }, [baseMap])

  // Performance profile (phone Light mode / High quality): canvas resolution, MSAA, fog, globe budget
  const perf = usePerformanceProfile(viewer)
  const stereoBoost = useStereoState().boost   // phones: coarser tiles while 3D glasses are on
  useGridFloor(viewer, { sphereRef: stereoSphereRef, tilesetRef, entityRef, hasModel: !!selectedModel, modelId: selectedModel?.id, googleShown })
  // Sync LOD + memory budget to the tilesets whenever quality or the profile changes
  useEffect(() => {
    const sse = effectiveSse(qualityToSSE(visualSettings.quality), perf)
    for (const ts of [tilesetRef.current, overlayTilesetRef.current]) {
      if (!ts) continue
      ts.maximumScreenSpaceError = sse
      const mem = tilesetMemoryOptions(perf)
      ts.cacheBytes = mem.cacheBytes ?? 512 * 1024 * 1024
      ts.maximumCacheOverflowBytes = mem.maximumCacheOverflowBytes ?? 512 * 1024 * 1024
    }
    // Colour correction is a full-screen pass: in Light mode skip it while every slider is neutral
    const vs = visualSettings
    const neutral = vs.exposure === 0 && vs.brightness === 0 && vs.contrast === 0 && vs.temperature === 0 && vs.saturation === 0
    if (ccStageRef.current) ccStageRef.current.enabled = perf.postProcessWhenNeutral || !neutral
  }, [visualSettings, perf.mode, viewer, stereoBoost])

  // Re-apply height offset whenever the slider or model changes
  useEffect(() => {
    if (tilesetRef.current) {
      applyHeightOffset(tilesetRef.current, geoidShiftOf(selectedModel) + visualSettings.heightOffset)
    }
  }, [visualSettings.heightOffset, selectedModel?.geoid_offset, selectedModel?.geoid_mode])

  // The same slider (and the geoid switch) moves a GLB model: its entity is re-placed, nothing is reloaded
  useEffect(() => {
    const e = entityRef.current
    const m = selectedModel
    if (!e || !m || m.model_type === '3d-tiles') return
    if (![m.longitude, m.latitude, m.altitude].every((n) => typeof n === 'number' && Number.isFinite(n))) return
    const position = Cesium.Cartesian3.fromDegrees(m.longitude, m.latitude, m.altitude + modelGeoidShift(m, m.latitude, m.longitude) + visualSettings.heightOffset)
    e.position = new Cesium.ConstantPositionProperty(position)
    e.orientation = new Cesium.ConstantProperty(Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(m.heading), Cesium.Math.toRadians(m.pitch), Cesium.Math.toRadians(m.roll),
    )))
    viewerRef.current?.scene.requestRender()
  }, [visualSettings.heightOffset, selectedModel?.geoid_offset, selectedModel?.geoid_mode])

  // ── Overlay model loading ────────────────────────────────────────────────────
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    // Remove previous overlay
    if (overlayEntityRef.current) {
      v.entities.remove(overlayEntityRef.current)
      overlayEntityRef.current = null
    }
    if (overlayTilesetRef.current) {
      v.scene.primitives.remove(overlayTilesetRef.current)
      overlayTilesetRef.current = null
    }

    if (!overlayModel || !overlayModelUrl) return

    if (overlayModel.model_type === '3d-tiles') {
      let cancelled = false
      const directUrl = overlayModelUrl.replace(
        /([a-z0-9-]+)\.fra1\.cdn\.digitaloceanspaces\.com/,
        '$1.fra1.digitaloceanspaces.com',
      )
      Cesium.Cesium3DTileset.fromUrl(directUrl, {
        maximumScreenSpaceError: effectiveSse(qualityToSSE(visualRef.current.quality)),
        ...tilesetMemoryOptions(),
      }).then((tileset) => {
        if (cancelled || !viewerRef.current) return
        const oc = Cesium.Cartographic.fromCartesian(tileset.boundingSphere.center)
        applyHeightOffset(tileset, modelGeoidShift(overlayModel, Cesium.Math.toDegrees(oc.latitude), Cesium.Math.toDegrees(oc.longitude)) + visualRef.current.heightOffset)
        viewerRef.current.scene.primitives.add(tileset)
        overlayTilesetRef.current = tileset
        viewerRef.current.scene.requestRender()
      }).catch(console.error)
      return () => { cancelled = true }
    }

    // glTF / GLB overlay
    const { longitude, latitude, altitude, heading, pitch, roll, scale } = overlayModel
    const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude + modelGeoidShift(overlayModel, latitude, longitude) + visualRef.current.heightOffset)
    const hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(heading),
      Cesium.Math.toRadians(pitch),
      Cesium.Math.toRadians(roll),
    )
    const entity = v.entities.add({
      name: overlayModel.name,
      position,
      orientation: new Cesium.ConstantProperty(
        Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
      ),
      model: {
        uri: overlayModelUrl,
        scale,
        minimumPixelSize: 64,
        maximumScale: 200_000,
        shadows: Cesium.ShadowMode.ENABLED,
      },
    })
    overlayEntityRef.current = entity
  }, [overlayModel?.id, overlayModelUrl])

  // ── Compare blend — crossfade base ↔ overlay ─────────────────────────────────
  useEffect(() => {
    if (compareMode === 'swipe') return   // the swipe line owns the shaders (effect below)
    const hasOverlay = overlayModel !== null && (overlayEntityRef.current !== null || overlayTilesetRef.current !== null)
    const baseAlpha    = hasOverlay ? 1 - compareBlend : 1
    const overlayAlpha = compareBlend

    // Base model
    if (tilesetRef.current) {
      if (hasOverlay) {
        tilesetRef.current.customShader = new Cesium.CustomShader({
          fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) { material.alpha = ${baseAlpha.toFixed(3)}; }`,
        })
      } else {
        tilesetRef.current.customShader = undefined
      }
    }
    if (entityRef.current?.model) {
      if (hasOverlay) {
        entityRef.current.model.colorBlendMode = new Cesium.ConstantProperty(Cesium.ColorBlendMode.HIGHLIGHT)
        entityRef.current.model.color = new Cesium.ConstantProperty(new Cesium.Color(1, 1, 1, baseAlpha))
      } else {
        entityRef.current.model.color = undefined
        entityRef.current.model.colorBlendMode = undefined
      }
    }

    // Overlay model
    if (overlayTilesetRef.current) {
      overlayTilesetRef.current.customShader = new Cesium.CustomShader({
        fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) { material.alpha = ${overlayAlpha.toFixed(3)}; }`,
      })
    }
    if (overlayEntityRef.current?.model) {
      overlayEntityRef.current.model.colorBlendMode = new Cesium.ConstantProperty(Cesium.ColorBlendMode.HIGHLIGHT)
      overlayEntityRef.current.model.color = new Cesium.ConstantProperty(new Cesium.Color(1, 1, 1, overlayAlpha))
    }
  }, [compareBlend, compareMode, overlayModel?.id,
      // Re-run once the overlay refs are populated (tracked via overlayModelUrl as a proxy)
      overlayModelUrl])

  // ── Compare swipe line ───────────────────────────────────────────────────────
  // A vertical line splits the screen: the base model (or the "before" orthophoto) is drawn on its left, the overlay model (or
  // the "after" orthophoto) on its right. Models use a custom shader that drops the fragments on the wrong side of the line
  // (the line position is a uniform, so dragging it recompiles nothing); orthophotos use Cesium's split direction.
  const swipeShaders = useRef<{ base?: Cesium.CustomShader; over?: Cesium.CustomShader }>({})
  const swipeActive = compareMode === 'swipe' && (overlayModel !== null || !!(orthoCompare?.beforeId && orthoCompare?.afterId))
  useEffect(() => {
    if (compareMode !== 'swipe') return
    const make = (side: number) => new Cesium.CustomShader({
      uniforms: {
        u_split: { type: Cesium.UniformType.FLOAT, value: swipePosRef.current },
        u_side: { type: Cesium.UniformType.FLOAT, value: side },
      },
      fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        bool left = (gl_FragCoord.x / czm_viewport.z) < u_split;
        if ((u_side < 0.5) != left) { discard; }
      }`,
    })
    const done = { base: false, over: false }
    const apply = () => {
      if (!done.base) {
        const sh = make(0)
        if (tilesetRef.current) { tilesetRef.current.customShader = sh; done.base = true }
        else if (entityRef.current?.model) {
          entityRef.current.model.color = undefined; entityRef.current.model.colorBlendMode = undefined
          entityRef.current.model.customShader = new Cesium.ConstantProperty(sh); done.base = true
        }
        if (done.base) swipeShaders.current.base = sh
      }
      if (overlayModel && !done.over) {
        const sh = make(1)
        if (overlayTilesetRef.current) { overlayTilesetRef.current.customShader = sh; done.over = true }
        else if (overlayEntityRef.current?.model) {
          overlayEntityRef.current.model.color = undefined; overlayEntityRef.current.model.colorBlendMode = undefined
          overlayEntityRef.current.model.customShader = new Cesium.ConstantProperty(sh); done.over = true
        }
        if (done.over) swipeShaders.current.over = sh
      }
      viewerRef.current?.scene.requestRender()
      return done.base && (!overlayModel || done.over)
    }
    apply()
    const timer = window.setInterval(() => { if (apply()) window.clearInterval(timer) }, 400)
    return () => {
      window.clearInterval(timer)
      if (tilesetRef.current) tilesetRef.current.customShader = undefined
      if (overlayTilesetRef.current) overlayTilesetRef.current.customShader = undefined
      if (entityRef.current?.model) entityRef.current.model.customShader = undefined
      if (overlayEntityRef.current?.model) overlayEntityRef.current.model.customShader = undefined
      swipeShaders.current = {}
      viewerRef.current?.scene.requestRender()
    }
  }, [compareMode, overlayModel?.id, overlayModelUrl, selectedModel?.id, modelUrl])
  // the line moves: update the uniforms and the imagery split position, nothing else
  useEffect(() => {
    const v = viewerRef.current
    if (!v || v.isDestroyed()) return
    swipeShaders.current.base?.setUniform('u_split', swipePos)
    swipeShaders.current.over?.setUniform('u_split', swipePos)
    v.scene.splitPosition = swipePos
    v.scene.requestRender()
  }, [swipePos, compareMode])


  // Sync orthophoto imagery layers
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    const orthoMap    = orthoLayerRef.current
    const incomingIds = new Set(orthophotos.map((p) => p.id))

    // Remove deleted layers
    for (const [id, layer] of orthoMap) {
      if (!incomingIds.has(id)) {
        v.imageryLayers.remove(layer, true)
        orthoMap.delete(id)
      }
    }

    // `orthophotos` is topmost-first. Cross-fade two opaque layers exactly: the lower of the pair stays fully opaque and
    // the upper one carries the fade weight, whichever order the user has stacked them in.
    const cmpAny = orthoCompare?.beforeId && orthoCompare.afterId ? orthoCompare : null
    const cmp = compareMode === 'swipe' ? null : cmpAny           // cross-fade
    const swipeCmp = compareMode === 'swipe' ? cmpAny : null      // swipe line: before on the left, after on the right
    const idxOf = (id: string) => orthophotos.findIndex((q) => q.id === id)
    const upperIsAfter = cmp ? idxOf(cmp.afterId) < idxOf(cmp.beforeId) : false

    for (const photo of orthophotos) {
      if (photo.status !== 'ready') continue

      if (orthoMap.has(photo.id)) {
        // Update existing layer
        const layer = orthoMap.get(photo.id)!
        layer.show  = photo.visible
        // Ortho compare overrides opacity for the two selected photos
        if (cmp && cmp.beforeId === photo.id) {
          layer.alpha = upperIsAfter ? 1 : 1 - cmp.blend
        } else if (cmp && cmp.afterId === photo.id) {
          layer.alpha = upperIsAfter ? cmp.blend : 1
        } else {
          layer.alpha = photo.opacity
        }
      } else {
        // Create new imagery layer
        const adminToken = localStorage.getItem('admin_token')
        const tileUrl = `${API_BASE}/orthophotos/${photo.id}/tiles/{z}/{x}/{y}.png${adminToken ? `?token=${encodeURIComponent(adminToken)}` : shareToken ? `?share=${encodeURIComponent(shareToken)}` : ''}`
        const providerOpts: Cesium.UrlTemplateImageryProvider.ConstructorOptions = {
          url: tileUrl,
          minimumLevel: photo.zoom_min ?? 0,
          maximumLevel: photo.zoom_max ?? 22,
          tileWidth:  256,
          tileHeight: 256,
          credit: '',
        }
        // Only set a bounding rectangle when every bound is a finite number AND
        // east>west / north>south. Anything else (null, undefined, NaN, degenerate)
        // would yield an invalid Rectangle and Cesium would silently never fetch tiles.
        const w = photo.bounds_west, e = photo.bounds_east
        const s = photo.bounds_south, n = photo.bounds_north
        const validBounds =
          Number.isFinite(w) && Number.isFinite(e) && Number.isFinite(s) && Number.isFinite(n)
          && (e as number) > (w as number) && (n as number) > (s as number)
        if (validBounds) {
          const buf = 0.002
          providerOpts.rectangle = Cesium.Rectangle.fromDegrees(
            (w as number) - buf, (s as number) - buf,
            (e as number) + buf, (n as number) + buf,
          )
        }
        console.log('[ortho] add layer', photo.id, photo.name, {
          visible: photo.visible, opacity: photo.opacity, validBounds,
          bounds: [w, s, e, n], zoom: [photo.zoom_min, photo.zoom_max],
        })
        const provider = new Cesium.UrlTemplateImageryProvider(providerOpts)
        const layer    = v.imageryLayers.addImageryProvider(provider)
        layer.show  = photo.visible
        layer.alpha = photo.opacity
        orthoMap.set(photo.id, layer)
      }
    }

    for (const photo of orthophotos) {
      const l = orthoMap.get(photo.id)
      if (!l) continue
      l.splitDirection = swipeCmp && photo.id === swipeCmp.beforeId ? Cesium.SplitDirection.LEFT
        : swipeCmp && photo.id === swipeCmp.afterId ? Cesium.SplitDirection.RIGHT : Cesium.SplitDirection.NONE
    }
    v.scene.splitPosition = swipePosRef.current

    // Deterministic stacking: draw bottom-up in list order (list = topmost first). New layers are added on top by
    // Cesium and reload order no longer matters. Only touch Cesium when the relative order actually differs.
    const bottomUp = [...orthophotos].reverse()
      .map((p) => orthoMap.get(p.id))
      .filter((l): l is Cesium.ImageryLayer => !!l)
    let ordered = true
    for (let k = 1; k < bottomUp.length; k++) {
      if (v.imageryLayers.indexOf(bottomUp[k - 1]) > v.imageryLayers.indexOf(bottomUp[k])) { ordered = false; break }
    }
    if (!ordered) for (const l of bottomUp) v.imageryLayers.raiseToTop(l)
    // The globe needs several frames to drop or repaint imagery after show / alpha / order change; with render-on-demand one
    // frame is not enough (a hidden orthophoto stayed painted until the camera moved)
    if (orthophotos.length) requestRenderFor(v, 1500)
  }, [orthophotos, orthoCompare, shareToken, compareMode])

  // Track camera lat/lon so we can check if it's over an orthophoto's bounds.
  // Updated on moveEnd (after each navigation gesture) — not per-frame.
  const [camPos, setCamPos] = useState<{ lat: number; lon: number } | null>(null)
  useEffect(() => {
    if (!viewer) return
    const v = viewer
    function readPos() {
      if (v.isDestroyed()) return
      const cart = Cesium.Cartographic.fromCartesian(v.camera.position)
      setCamPos({
        lat: Cesium.Math.toDegrees(cart.latitude),
        lon: Cesium.Math.toDegrees(cart.longitude),
      })
    }
    readPos()
    v.camera.moveEnd.addEventListener(readPos)
    return () => { if (!v.isDestroyed()) v.camera.moveEnd.removeEventListener(readPos) }
  }, [viewer])

  // Nadir lock: only engage when camera is actually over a visible ortho's bounds
  const PAD = 0.005 // ~500 m padding around bounds in degrees
  const hasActiveOrtho = camPos != null && orthophotos.some((p) => {
    if (p.status !== 'ready' || !p.visible) return false
    if (p.bounds_west == null || p.bounds_east == null ||
        p.bounds_south == null || p.bounds_north == null) return false
    return camPos.lon >= p.bounds_west  - PAD && camPos.lon <= p.bounds_east  + PAD
        && camPos.lat >= p.bounds_south - PAD && camPos.lat <= p.bounds_north + PAD
  })

  // The lock is for looking at an orthophoto on its own. With a 3D model open the user needs to tilt around it, and snapping
  // the camera to straight-down at its old position used to push the model off the screen: no lock while a model is open.
  const nadirLock = hasActiveOrtho && !selectedModel
  const prevActiveRef = useRef(false)
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    const ctrl = v.scene.screenSpaceCameraController
    ctrl.enableTilt = !nadirLock
    ctrl.enableLook = !nadirLock

    // Snap to nadir only when first entering an ortho area, not on every move
    const justEntered = nadirLock && !prevActiveRef.current
    prevActiveRef.current = nadirLock
    if (justEntered && v.camera.pitch > Cesium.Math.toRadians(-85)) {
      // Look straight down at the point the camera was looking at (same distance), instead of at the spot below the camera
      const c = v.scene.canvas
      const mid = new Cesium.Cartesian2(c.clientWidth / 2, c.clientHeight / 2)
      const target = v.camera.pickEllipsoid(mid, v.scene.globe.ellipsoid)
      if (target) {
        const range = Math.max(Cesium.Cartesian3.distance(v.camera.position, target), 5)
        v.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
          offset: new Cesium.HeadingPitchRange(v.camera.heading, Cesium.Math.toRadians(-90), range),
          duration: 0.5,
        })
      } else {
        const cart = Cesium.Cartographic.fromCartesian(v.camera.position)
        v.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, cart.height),
          orientation: { heading: v.camera.heading, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 0.5,
        })
      }
    }
  }, [nadirLock])

  // Measurement
  // Never take points on Google's tiles (terms bar measuring on them): tools are off while shown
  const toolWanted = measureMode !== 'none' || geopointActive
  useEffect(() => {
    if (googleShown && toolWanted) onNotice('Measuring is turned off while Google 3D is shown')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleShown, toolWanted])
  // Render only on change: gestures, hover while a tool is active, scene collections, every React commit
  useRenderOnDemand(viewer, toolWanted)
  useRenderAfterCommit(viewer)
  const recover = () => {
    setQualityMode('light')   // a phone that lost its context gets the cheaper profile on the next start
    onRecover()
  }
  const gpu = useContextLoss(viewer, recover)
  useMeasure(viewer, googleShown ? 'none' : measureMode, baseElevation, measureKey, onMeasureResult, heightRef, { undoRef, redoRef, finishRef, onNotice, onProfile: setProfile })
  useGeopoints(viewer, geopointActive && !googleShown, geopoints, onGeopointAdd ?? (() => {}), heightRef, { onNotice })
  // Red/cyan 3D glasses (waits while a tool is active; off for Google 3D and for pages without a 3D model)
  useStereo(viewer, {
    sphereRef: stereoSphereRef, toolActive: toolWanted, googleShown, hasModel: !!selectedModel, onNotice,
    flatMap: baseMap !== 'none' || orthophotos.some((p) => p.status === 'ready' && p.visible),
  })

  // Height Offset slider -> moves a GLB; draped layers follow it once the slider has rested for a moment
  const [drapeShift, setDrapeShift] = useState(0)
  useEffect(() => {
    const t = window.setTimeout(() => setDrapeShift(visualSettings.heightOffset), 600)
    return () => window.clearTimeout(t)
  }, [visualSettings.heightOffset])

  // Sync KML/overlay layers.
  // Each layer is loaded once per key (file + placement mode + retry counter). Afterwards ONLY what changed is touched:
  // visibility when it differs, the vertical offset when that layer's offset differs (never for the others, so 3D
  // polygons keep their heights and clamped lines keep clamping).
  useEffect(() => {
    const v = viewer
    if (!v || v.isDestroyed()) return
    const rt = layerRtRef.current
    const loading = layerLoadingRef.current
    const wanted = new Set(layers.map((l) => l.id))

    for (const [id, r] of rt) {
      if (!wanted.has(id)) { v.dataSources.remove(r.ds, true); rt.delete(id) }
    }
    for (const id of [...loading.keys()]) if (!wanted.has(id)) loading.delete(id)

    // Cesium can clamp to the globe and to 3D Tiles but not to a glTF model: for a GLB the layer is draped by height sampling
    const onGlb = !!selectedModel && selectedModel.model_type !== '3d-tiles'
    for (const layer of layers) {
      const drape = layer.clampMode === 'drape' && layer.fileType !== 'czml'
      const offset = drape ? 0 : layer.heightOffset
      // a draped layer on a GLB is sampled again when the model is moved with the Height Offset slider
      const key = `${layer.url}|${drape ? (onGlb ? `glb${drapeShift}` : 'drape') : 'heights'}|${layer.reloadKey}`
      let cur = rt.get(layer.id)

      if (cur && cur.key !== key) {          // file or placement mode changed: rebuild from the file
        v.dataSources.remove(cur.ds, true)
        rt.delete(layer.id)
        cur = undefined
      }

      if (cur) {
        if (cur.visible !== layer.visible) { applyVisibility(cur.ds, layer.visible); cur.visible = layer.visible }
        if (cur.offset !== offset) { applyLayerOffset(cur.ds, offset, cur.origins); cur.offset = offset }
        continue
      }
      if (loading.get(layer.id) === key) continue   // already on its way

      loading.set(layer.id, key)
      onLayerStateRef.current?.(layer.id, { state: 'loading' })
      const stillWanted = () => loading.get(layer.id) === key && !v.isDestroyed()
      loadLayerDataSource(v, layer, drape && !onGlb)
        .then(async (ds) => {
          if (!stillWanted()) return           // deleted, hidden away or reloaded meanwhile: never add a zombie
          loading.delete(layer.id)
          nameDataSource(ds, layer.name)
          const origins = captureOrigins(ds)
          const r: LayerRuntime = { ds, key, offset: 0, visible: true, origins }
          rt.set(layer.id, r)
          // Use the latest wishes (they may have changed while the file loaded)
          const latest = layersRef.current.find((l) => l.id === layer.id) ?? layer
          const latestDrape = latest.clampMode === 'drape' && latest.fileType !== 'czml'
          if (!latest.visible) { applyVisibility(ds, false); r.visible = false }
          const off = latestDrape ? 0 : latest.heightOffset
          if (off !== 0) { applyLayerOffset(ds, off, origins); r.offset = off }
          v.dataSources.add(ds)
          v.scene.requestRender()
          onLayerStateRef.current?.(layer.id, { state: 'ok' })
          if (drape && onGlb) {
            const alive = () => rt.get(layer.id) === r
            const ready = async (): Promise<boolean> => {
              for (let waited = 0; waited < 90_000; waited += 250) {
                if (!alive() || v.isDestroyed()) return false
                if (modelReadyRef.current) return true
                await new Promise((res) => setTimeout(res, 250))
              }
              return false
            }
            const skip = v.entities.values.filter((e) => !e.model)
            for (let i = 0; i < v.dataSources.length; i++) skip.push(...v.dataSources.get(i).entities.values)
            await drapeOnModel(v, ds, ready, alive, skip)
          } else if (drape) await drapePoints(v, ds, () => rt.get(layer.id) === r)
        })
        .catch((err: unknown) => {
          if (!stillWanted()) return
          loading.delete(layer.id)
          const status = (err as { statusCode?: number } | null)?.statusCode
          const msg = status ? `the file could not be downloaded (HTTP ${status})` : err instanceof Error ? err.message : String(err)
          console.error('[layer]', layer.name, err)
          onLayerStateRef.current?.(layer.id, { state: 'error', message: `The viewer could not draw this file: ${msg.slice(0, 200)}` })
        })
    }
    v.scene.requestRender()
  }, [layers, viewer, drapeShift])

  // Click a layer feature: name, attributes, coordinates (WGS84 / ITM). Off while a tool or Google 3D owns the click.
  const [featurePick, setFeaturePick] = useState<FeaturePick | null>(null)
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || toolWanted || googleShown) { setFeaturePick(null); return }
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      if (!layerRtRef.current.size) return
      const picked = viewer.scene.pick(click.position) as { id?: unknown } | undefined
      const ent = picked?.id instanceof Cesium.Entity ? picked.id : undefined
      let layerName: string | null = null
      if (ent) {
        for (const [id, r] of layerRtRef.current) {
          if (ent.entityCollection?.owner === r.ds) { layerName = layersRef.current.find((l) => l.id === id)?.name ?? 'Layer'; break }
        }
      }
      if (!ent || layerName === null) { setFeaturePick(null); return }
      let cart: Cesium.Cartesian3 | undefined
      try { cart = viewer.scene.pickPositionSupported ? viewer.scene.pickPosition(click.position) : undefined } catch { /* no depth */ }
      cart ??= viewer.camera.pickEllipsoid(click.position, viewer.scene.globe.ellipsoid) ?? undefined
      let at: FeaturePick['click'] = null
      if (cart) { const c = Cesium.Cartographic.fromCartesian(cart); at = { lon: Cesium.Math.toDegrees(c.longitude), lat: Cesium.Math.toDegrees(c.latitude) } }
      setFeaturePick({ layerName, info: describeEntity(ent), click: at })
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    return () => { handler.destroy() }
  }, [viewer, toolWanted, googleShown])
  // a layer that is hidden or removed must not leave its card behind
  useEffect(() => {
    if (!featurePick) return
    const l = layers.find((x) => x.name === featurePick.layerName)
    if (!l || !l.visible) setFeaturePick(null)
  }, [layers, featurePick])

  return (
    <div className="qs-keep relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* Hidden credit container — keeps Cesium logo off the canvas */}
      {/* Credits stay hidden except while Google 3D is shown: Google requires attribution on screen */}
      <div ref={creditRef} className={googleShown ? 'absolute bottom-1 left-2 z-10 max-w-[60%] text-[10px] text-white/80 [&_a]:text-white/90' : 'hidden'} />
      {featurePick && <LayerFeatureCard pick={featurePick} onClose={() => setFeaturePick(null)} />}
      {swipeActive && <SwipeLine pos={swipePos} onChange={(p) => onSwipePosChange?.(p)} />}
      <Chrome>
        <OrientationAids viewer={viewer} onHome={selectedModel ? () => homeRef.current?.() : undefined} />
        {profile && measureMode === 'profile' && <ProfilePanel profile={profile} onClose={() => setProfile(null)} />}
      </Chrome>
      {notice && (
        <div role="status"
             className="absolute top-16 left-1/2 -translate-x-1/2 rounded-2xl border border-white/[0.15]
                        bg-[#0b100d]/[0.97] backdrop-blur-xl shadow-2xl shadow-black/80 text-white/80
                        text-xs px-3 py-2 max-w-sm text-center z-10 pointer-events-none">
          {notice}
        </div>
      )}
      {(gpu !== 'ok' || startError) && (
        <GpuNoticeCard kind={startError ? 'start' : gpu === 'repeated' ? 'repeated' : 'lost'} onReload={recover} />
      )}
      {loadingModel && !tileError && (
        <div role="status" className="absolute top-14 left-1/2 -translate-x-1/2 rounded-full border border-white/[0.15] bg-[#0b100d]/[0.92] text-white/80
                        text-xs px-3 py-1.5 z-10 pointer-events-none">
          Loading 3D model…
        </div>
      )}
      {tileError && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-red-900/90 text-red-100
                        text-xs px-3 py-2 rounded-md max-w-sm text-center z-10 pointer-events-none">
          ⚠ {tileError}
        </div>
      )}
    </div>
  )
}
/** The draggable swipe line of the compare: mouse and touch, he + en side labels. */
function SwipeLine({ pos, onChange }: { pos: number; onChange: (p: number) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    onChange(Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)))
  }
  return (
    <div ref={rootRef} className="absolute inset-0 z-[15] pointer-events-none" data-testid="swipe-line">
      <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.7)]" style={{ left: `${pos * 100}%` }} />
      <div
        role="slider" aria-label="Compare swipe line / קו השוואה" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos * 100)}
        className="absolute top-0 bottom-0 w-10 -ml-5 pointer-events-auto cursor-ew-resize flex items-center justify-center"
        style={{ left: `${pos * 100}%`, touchAction: 'none' }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag(e) }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e) }}
      >
        <div className="h-9 w-9 rounded-full bg-white/95 text-black text-xs font-bold flex items-center justify-center shadow-lg select-none">&#x2194;</div>
      </div>
      <div className="absolute top-16 text-[11px] font-semibold px-2 py-1 rounded-lg bg-black/60 text-white" style={{ left: `calc(${pos * 100}% - 6px)`, transform: 'translateX(-100%)' }}>
        <span dir="rtl">לפני / בסיס</span> · Before / Base
      </div>
      <div className="absolute top-16 text-[11px] font-semibold px-2 py-1 rounded-lg bg-black/60 text-white" style={{ left: `calc(${pos * 100}% + 6px)` }}>
        After / Overlay · <span dir="rtl">אחרי / שכבה</span>
      </div>
    </div>
  )
}

/** Rebuilds the whole viewer (fresh WebGL context, every effect re-run) when the user taps reload after a lost context. */
export function CesiumViewer(props: Props) {
  const [epoch, setEpoch] = useState(0)
  return <CesiumViewerInner key={epoch} {...props} onRecover={() => setEpoch((e) => e + 1)} />
}
