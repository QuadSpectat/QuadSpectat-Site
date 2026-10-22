/** A camera position the owner can save and clients can jump to. Angles in radians, as Cesium reports them. */
export interface CameraState {
  lon: number      // degrees
  lat: number      // degrees
  height: number   // metres, ellipsoidal (as Cesium uses)
  heading: number  // radians
  pitch: number    // radians
  roll: number     // radians
}

export interface SavedView {
  id: string
  model_id: string
  name: string
  camera: CameraState
  position: number
  created_at: string
}

/** Exposed by CesiumViewer (through a ref) so pages can save and restore views without touching Cesium. */
export interface ViewApi {
  capture: () => CameraState | null
  flyTo: (c: CameraState) => void
}
