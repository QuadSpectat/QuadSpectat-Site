import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import './index.css'
import { LandingPage } from './pages/LandingPage'
import { ClientPage } from './pages/ClientPage'
import { LoadingShell, ErrorBoundary } from './components/AppShell'
import { loadCesium } from './lib/cesiumLoader'
import { startEarlyLoad } from './lib/earlyModel'

// Route-level code splitting. Only the globe routes (/app, /v/<token>) wait for Cesium; /, /drone, /c/<token>
// and /admin never download it. The 3D engine must be on the page before the viewer chunk is evaluated.
const App = lazy(async () => { await loadCesium(); return import('./App') })
const SharedViewer = lazy(async () => {
  await loadCesium()
  const m = await import('./pages/SharedViewer')
  return { default: m.SharedViewer }
})
const AdminPage = lazy(async () => {
  const m = await import('./pages/AdminPage')
  return { default: m.AdminPage }
})

function RouteFallback() {
  const { pathname } = useLocation()
  return <LoadingShell label={/^\/(app|v\/)/.test(pathname) ? 'Loading 3D…' : 'Loading…'} />
}

// Share-link visits: look up the share and warm the tileset root while the 3D engine downloads.
startEarlyLoad(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/drone" element={<LandingPage />} />
            <Route path="/app" element={<App />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/v/:token" element={<SharedViewer />} />
            <Route path="/c/:token" element={<ClientPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
