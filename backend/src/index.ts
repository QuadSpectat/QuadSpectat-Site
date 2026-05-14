import express, { Request, Response, NextFunction } from 'express'
import { env } from './env'
import modelsRouter from './routes/models'
import uploadsRouter from './routes/uploads'
import shareRouter from './routes/share'
import layersRouter from './routes/layers'
import orthophotosRouter from './routes/orthophotos'

const app = express()

// ── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://quadspectat.site',
  'https://www.quadspectat.site',
]
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/models', modelsRouter)
app.use('/api/uploads', uploadsRouter)
app.use('/api/share', shareRouter)
app.use('/api/layers', layersRouter)
app.use('/api/orthophotos', orthophotosRouter)

// Central error handler — include message outside production for easier debugging
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message })
})

app.listen(Number(env.PORT), () => {
  console.log(`Backend running on http://localhost:${env.PORT}`)
})
