import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App'
import { SharedViewer } from './pages/SharedViewer'
import { LandingPage } from './pages/LandingPage'
import { AdminPage } from './pages/AdminPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<App />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/v/:token" element={<SharedViewer />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
