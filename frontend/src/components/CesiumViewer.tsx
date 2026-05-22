import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// Disable Ion so Cesium doesn't attempt Ion network calls without a token
Cesium.Ion.defaultAccessToken = ''
import { useMeasure } from '@/hooks/useMeasure'
import type { Model } from '@/lib/api'
import type { MeasureMode } from '@/lib/measure'
import type { VisualSettings } from '@/lib/visualControls'
import { DEFAULT_VISUAL, qualityToSSE } from '@/lib/visualControls'
import type { BaseMap } from '@/components/MapSwitcher'

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

import type { ResolvedLayer } from '@/components/LayerPanel'
import type { ResolvedOrthophoto } from '@/components/OrthophotoPanel'
import type { OrthoCompare } from '@/components/ComparePanel'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

// Sets visibility on a DataSource AND each of its entities.
// DataSource.show alone is sometimes not enough for KML/KMZ in Cesium.
function applyVisibility(ds: Cesium.DataSource, visible: boolean): void {
  ds.show = visible
  for (const entity of ds.entities.values) {
    entity.show = visible
  }
}

// ── Layer height offset helpers ──────────────────────────────────────────────

interface EntityOrigin {
  // rectangle / ground-overlay
  rectHeight?: number
  // polygon flat height
  polyHeight?: number
  // polyline positions (cloned originals)
  linePositions?: Cesium.Cartesian3[]
  // point / billboard position
  pointCart?: Cesium.Cartesian3
}

// Captures the original height data for every entity in a DataSource.
// Called once after the DataSource loads so we can re-apply absolute offsets.
function captureOrigins(ds: Cesium.DataSource): Map<string, EntityOrigin> {
  const now = Cesium.JulianDate.now()
  const map = new Map<string, EntityOrigin>()
  for (const entity of ds.entities.values) {
    const o: EntityOrigin = {}
    if (entity.rectangle) {
      o.rectHeight = (entity.rectangle.height?.getValue(now) as number | undefined) ?? 0
    }
    if (entity.polygon) {
      o.polyHeight = (entity.polygon.height?.getValue(now) as number | undefined) ?? 0
    }
    if (entity.polyline?.positions) {
      const pts = entity.polyline.positions.getValue(now) as Cesium.Cartesian3[] | undefined
      if (pts?.length) o.linePositions = pts.map((p) => p.clone())
    }
    if (entity.position && !entity.polyline && !entity.polygon) {
      const pos = entity.position.getValue(now, new Cesium.Cartesian3())
      if (Cesium.defined(pos)) o.pointCart = pos.clone()
    }
    map.set(entity.id, o)
  }
  return map
}

// Applies an absolute vertical offset (metres) to every entity, reading from
// the captured originals so there is no float drift on repeated adjustments.
// Also disables ground-clamping flags so Cesium actually respects the heights.
function applyLayerOffset(
  ds: Cesium.DataSource,
  offsetM: number,
  origins: Map<string, EntityOrigin>,
): void {
  for (const entity of ds.entities.values) {
    const o = origins.get(entity.id)
    if (!o) continue

    // Rectangle (KML GroundOverlay)
    if (entity.rectangle && o.rectHeight !== undefined) {
      entity.rectangle.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
      entity.rectangle.height = new Cesium.ConstantProperty(o.rectHeight + offsetM)
    }

    // Polygon — use flat height property; unset perPositionHeight so it's respected
    if (entity.polygon && o.polyHeight !== undefined) {
      entity.polygon.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
      entity.polygon.perPositionHeight = new Cesium.ConstantProperty(false)
      entity.polygon.height = new Cesium.ConstantProperty(o.polyHeight + offsetM)
    }

    // Polyline — disable clampToGround and shift each vertex Z
    if (entity.polyline && o.linePositions?.length) {
      entity.polyline.clampToGround = new Cesium.ConstantProperty(false)
      entity.polyline.positions = new Cesium.ConstantProperty(
        o.linePositions.map((p) => {
          const c = Cesium.Cartographic.fromCartesian(p)
          return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + offsetM)
        }),
      )
    }

    // Point / billboard
    if (entity.position && o.pointCart) {
      if (entity.billboard) {
        entity.billboard.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
      }
      if (entity.label) {
        entity.label.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
      }
      const c = Cesium.Cartographic.fromCartesian(o.pointCart)
      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height + offsetM),
      )
    }
  }
}
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
  layers?: ResolvedLayer[]
  orthophotos?: ResolvedOrthophoto[]
  /** Overlay model for time-comparison crossfade */
  overlayModel?: Model | null
  overlayModelUrl?: string | null
  /** 0 = base only, 1 = overlay only */
  compareBlend?: number
  /** Orthophoto before/after compare state */
  orthoCompare?: OrthoCompare | null
  /** Called with the detected geoid offset (m) when user snaps to ground */
  onSnapToGround?: (detectedOffset: number) => void
  /** Parent passes a ref; CesiumViewer writes the snap-to-ground function into it */
  snapRef?: React.MutableRefObject<(() => void) | null>
  /** Parent passes a ref; CesiumViewer writes the reset-camera function into it */
  resetCameraRef?: React.MutableRefObject<(() => void) | null>
  /** Parent passes a ref; CesiumViewer writes the fly-to-orthophoto function into it */
  flyToOrthoRef?: React.MutableRefObject<((photo: ResolvedOrthophoto) => void) | null>
}

export function CesiumViewer({
  selectedModel, modelUrl,
  measureMode, baseElevation, measureKey, onMeasureResult,
  visualSettings = DEFAULT_VISUAL,
  baseMap = 'none',
  layers = [],
  orthophotos = [],
  overlayModel = null,
  overlayModelUrl = null,
  compareBlend = 0.5,
  orthoCompare = null,
  onSnapToGround,
  snapRef,
  resetCameraRef,
  flyToOrthoRef,
}: Props) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const creditRef     = useRef<HTMLDivElement>(null)
  const viewerRef    = useRef<Cesium.Viewer | null>(null)
  const entityRef    = useRef<Cesium.Entity | null>(null)
  const tilesetRef   = useRef<Cesium.Cesium3DTileset | null>(null)
  // Map from layer id → loaded DataSource
  const layerDsRef      = useRef<Map<string, Cesium.DataSource>>(new Map())
  // IDs currently loading — prevents duplicate loads on rapid visibility toggles
  const layerPendingRef = useRef<Set<string>>(new Set())
  // Latest desired visibility per layer — so load completion uses up-to-date value
  const layerVisRef     = useRef<Map<string, boolean>>(new Map())
  // Captured original entity heights per layer (keyed by entity id)
  const layerOriginsRef = useRef<Map<string, Map<string, EntityOrigin>>>(new Map())
  // Tracked base-map imagery layer (so we can swap without removeAll)
  const baseLayerRef    = useRef<Cesium.ImageryLayer | null>(null)
  // Google Photorealistic 3D Tiles primitive (basemap alternative)
  const google3dRef     = useRef<Cesium.Cesium3DTileset | null>(null)
  // Map from orthophoto id → Cesium ImageryLayer
  const orthoLayerRef   = useRef<Map<string, Cesium.ImageryLayer>>(new Map())
  // Overlay model for time-comparison
  const overlayEntityRef  = useRef<Cesium.Entity | null>(null)
  const overlayTilesetRef = useRef<Cesium.Cesium3DTileset | null>(null)

  // Keep a ref so shader uniform getters always read the latest values
  const visualRef = useRef<VisualSettings>(visualSettings)
  visualRef.current = visualSettings

  // Exposed as state so useMeasure re-runs once the viewer is ready
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null)
  const [tileError, setTileError] = useState<string | null>(null)

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

    const v = new Cesium.Viewer(containerRef.current, {
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
    })

    v.imageryLayers.removeAll()
    v.scene.backgroundColor = Cesium.Color.BLACK
    // Prevent the globe surface from occluding models placed at/near ground level
    v.scene.globe.depthTestAgainstTerrain = false

    // Add color-correction post-process stage
    // Uniform getters read from visualRef so values update every frame without
    // recreating the stage.
    v.scene.postProcessStages.add(new Cesium.PostProcessStage({
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
      setViewer(null)
    }
  }, [])

  // Model loading
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return

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

    if (!selectedModel || !modelUrl) return

    setTileError(null)

    // 3D Tiles path
    if (selectedModel.model_type === '3d-tiles') {
      let cancelled = false
      // Use direct Spaces URL (not CDN) to avoid CDN CORS cache issues
      const directUrl = modelUrl.replace(
        /([a-z0-9-]+)\.fra1\.cdn\.digitaloceanspaces\.com/,
        '$1.fra1.digitaloceanspaces.com',
      )
      Cesium.Cesium3DTileset.fromUrl(directUrl, {
        maximumScreenSpaceError: qualityToSSE(visualRef.current.quality),
      }).then((tileset) => {
        if (cancelled || !viewerRef.current) return
        viewerRef.current.scene.primitives.add(tileset)
        tilesetRef.current = tileset
        // Combined offset: model's stored geoid correction + user fine-tune slider
        const geoidOffset = selectedModel?.geoid_offset ?? 0
        applyHeightOffset(tileset, geoidOffset + visualRef.current.heightOffset)
        const fly = () => { if (viewerRef.current) void viewerRef.current.zoomTo(tileset) }
        fly()
        if (resetCameraRef) resetCameraRef.current = fly
      }).catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[CesiumViewer] Failed to load 3D Tileset:', err)
          setTileError(msg)
        }
      })
      return () => { cancelled = true }
    }

    // glTF / GLB entity path
    const { longitude, latitude, altitude, heading, pitch, roll, scale } = selectedModel
    const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude)
    const hpr = new Cesium.HeadingPitchRoll(
      Cesium.Math.toRadians(heading),
      Cesium.Math.toRadians(pitch),
      Cesium.Math.toRadians(roll),
    )

    const entity = v.entities.add({
      name: selectedModel.name,
      position,
      orientation: new Cesium.ConstantProperty(
        Cesium.Transforms.headingPitchRollQuaternion(position, hpr),
      ),
      model: {
        uri: modelUrl,
        scale,
        minimumPixelSize: 64,
        maximumScale: 200_000,
        shadows: Cesium.ShadowMode.ENABLED,
      },
    })

    entityRef.current = entity
    const fly = () => { if (viewerRef.current) void viewerRef.current.flyTo(entity, { duration: 1.5 }) }
    fly()
    if (resetCameraRef) resetCameraRef.current = fly
  }, [selectedModel?.id, modelUrl])

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
        setTileError('Google 3D requires VITE_GOOGLE_MAPS_KEY — add it to frontend/.env.local and restart the dev server')
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
          } else {
            tileset.destroy()
          }
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          setTileError(`Google 3D: ${msg}`)
        })
      }
    }
    // 'none' → base layer already removed
  }, [baseMap])

  // Sync LOD to tileset whenever quality changes
  useEffect(() => {
    if (tilesetRef.current) {
      tilesetRef.current.maximumScreenSpaceError = qualityToSSE(visualSettings.quality)
    }
  }, [visualSettings.quality])

  // Re-apply height offset whenever the slider or model changes
  useEffect(() => {
    if (tilesetRef.current) {
      const geoidOffset = selectedModel?.geoid_offset ?? 0
      applyHeightOffset(tilesetRef.current, geoidOffset + visualSettings.heightOffset)
    }
  }, [visualSettings.heightOffset, selectedModel?.geoid_offset])

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
        maximumScreenSpaceError: qualityToSSE(visualRef.current.quality),
      }).then((tileset) => {
        if (cancelled || !viewerRef.current) return
        const geoidOffset = overlayModel.geoid_offset ?? 0
        applyHeightOffset(tileset, geoidOffset + visualRef.current.heightOffset)
        viewerRef.current.scene.primitives.add(tileset)
        overlayTilesetRef.current = tileset
      }).catch(console.error)
      return () => { cancelled = true }
    }

    // glTF / GLB overlay
    const { longitude, latitude, altitude, heading, pitch, roll, scale } = overlayModel
    const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude)
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
  }, [compareBlend, overlayModel?.id,
      // Re-run once the overlay refs are populated (tracked via overlayModelUrl as a proxy)
      overlayModelUrl])

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

    for (const photo of orthophotos) {
      if (photo.status !== 'ready') continue

      if (orthoMap.has(photo.id)) {
        // Update existing layer
        const layer = orthoMap.get(photo.id)!
        layer.show  = photo.visible
        // Ortho compare overrides opacity for the two selected photos
        if (orthoCompare?.beforeId === photo.id && orthoCompare.afterId) {
          layer.alpha = (1 - orthoCompare.blend)
        } else if (orthoCompare?.afterId === photo.id && orthoCompare.beforeId) {
          layer.alpha = orthoCompare.blend
        } else {
          layer.alpha = photo.opacity
        }
      } else {
        // Create new imagery layer
        const tileUrl = `${API_BASE}/orthophotos/${photo.id}/tiles/{z}/{x}/{y}.png`
        const providerOpts: Cesium.UrlTemplateImageryProvider.ConstructorOptions = {
          url: tileUrl,
          minimumLevel: photo.zoom_min ?? 0,
          maximumLevel: photo.zoom_max ?? 22,
          tileWidth:  256,
          tileHeight: 256,
          credit: '',
        }
        if (photo.bounds_west !== null && photo.bounds_south !== null &&
            photo.bounds_east !== null && photo.bounds_north !== null) {
          providerOpts.rectangle = Cesium.Rectangle.fromDegrees(
            photo.bounds_west, photo.bounds_south, photo.bounds_east, photo.bounds_north,
          )
        }
        const provider = new Cesium.UrlTemplateImageryProvider(providerOpts)
        const layer    = v.imageryLayers.addImageryProvider(provider)
        layer.show  = photo.visible
        layer.alpha = photo.opacity
        orthoMap.set(photo.id, layer)
      }
    }
  }, [orthophotos, orthoCompare])

  // Measurement
  useMeasure(viewer, measureMode, baseElevation, measureKey, onMeasureResult)

  // Sync KML/overlay layers
  useEffect(() => {
    const v = viewerRef.current
    if (!v) return

    const existing    = layerDsRef.current
    const pending     = layerPendingRef.current
    const wantedVis   = layerVisRef.current
    const allOrigins  = layerOriginsRef.current
    const incomingIds = new Set(layers.map((l) => l.id))

    // Remove deleted layers
    for (const [id, ds] of existing) {
      if (!incomingIds.has(id)) {
        v.dataSources.remove(ds, true)
        existing.delete(id)
        wantedVis.delete(id)
        allOrigins.delete(id)
      }
    }

    for (const layer of layers) {
      wantedVis.set(layer.id, layer.visible)

      if (existing.has(layer.id)) {
        const ds = existing.get(layer.id)!
        applyVisibility(ds, layer.visible)

        const origins = allOrigins.get(layer.id)
        if (origins) {
          applyLayerOffset(ds, layer.heightOffset ?? 0, origins)
        }
      } else if (!pending.has(layer.id)) {
        pending.add(layer.id)
        let loadPromise: Promise<Cesium.DataSource>
        const lowerUrl = layer.url.toLowerCase().split('?')[0]
        if (lowerUrl.endsWith('.kml') || lowerUrl.endsWith('.kmz')) {
          loadPromise = Cesium.KmlDataSource.load(layer.url, {
            camera: v.camera,
            canvas: v.canvas,
          })
        } else if (lowerUrl.endsWith('.czml')) {
          loadPromise = Cesium.CzmlDataSource.load(layer.url)
        } else {
          loadPromise = Cesium.GeoJsonDataSource.load(layer.url)
        }
        loadPromise.then((ds) => {
          pending.delete(layer.id)
          if (!viewerRef.current) return
          ds.name = layer.name
          applyVisibility(ds, wantedVis.get(layer.id) ?? true)
          // Capture originals BEFORE applying any offset
          const origins = captureOrigins(ds)
          allOrigins.set(layer.id, origins)
          const off = layer.heightOffset ?? 0
          if (off !== 0) applyLayerOffset(ds, off, origins)
          viewerRef.current.dataSources.add(ds)
          existing.set(layer.id, ds)
        }).catch((err) => {
          pending.delete(layer.id)
          console.error(err)
        })
      }
    }
  }, [layers])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {/* Hidden credit container — keeps Cesium logo off the canvas */}
      <div ref={creditRef} className="hidden" />
      {tileError && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-red-900/90 text-red-100
                        text-xs px-3 py-2 rounded-md max-w-sm text-center z-10 pointer-events-none">
          ⚠ {tileError}
        </div>
      )}
    </div>
  )
}