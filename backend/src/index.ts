import express, { Request, Response, NextFunction } from 'express'
import { env } from './env'
import modelsRouter from './routes/models'
import uploadsRouter from './routes/uploads'
import shareRouter from './routes/share'
import layersRouter from './routes/layers'
import orthophotosRouter, { warmupOrthophotos } from './routes/orthophotos'
import authRouter from './routes/auth'
import viewsRouter from './routes/views'
import { clientsAdmin, clientsPublic } from './routes/clients'
import { requireAuth } from './middleware/auth'
import { LAYER_LIMITS, mb } from './layerLimits'

const app = express()

// ── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://quadspectat.com',
  'https://www.quadspectat.com',
  'https://quadspectat.github.io',
]
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

// Layer files are read as raw bytes BEFORE the global JSON parser. A browser labels a .json file
// "application/json"; with express.json() first it consumed the stream, req.body became an object and an EMPTY
// object was stored while the UI reported success (and any .json over 100 KB failed with 500).
// Auth runs first so an anonymous caller cannot make the server buffer 25 MB.
app.use('/api/layers/upload', requireAuth, express.raw({ type: () => true, limit: LAYER_LIMITS.maxBytes }),
  (err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: `The file is larger than the ${mb(LAYER_LIMITS.maxBytes)} limit per layer. Simplify it or split it into several layers.` })
      return
    }
    next(err)
  })

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRouter)
app.use('/api/models', modelsRouter)
app.use('/api/uploads', uploadsRouter)
app.use('/api/share', shareRouter)
app.use('/api/layers', layersRouter)
app.use('/api/views', viewsRouter)
app.use('/api/orthophotos', orthophotosRouter)
app.use('/api/clients', clientsAdmin)   // admin: manage client pages
app.use('/api/client', clientsPublic)   // public: what a client's private link loads

// Central error handler — include message outside production for easier debugging
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message })
})

app.listen(Number(env.PORT), () => {
  console.log(`Backend running on http://localhost:${env.PORT}`)
  warmupOrthophotos().catch(console.error)
})
