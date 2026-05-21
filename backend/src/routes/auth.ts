import { Router, Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const router = Router()

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = req.body as { username?: unknown; password?: unknown }
    const adminUser    = process.env.ADMIN_USERNAME
    const passwordHash = process.env.ADMIN_PASSWORD_HASH
    const jwtSecret    = process.env.JWT_SECRET

    if (!adminUser || !passwordHash || !jwtSecret) {
      res.status(503).json({ error: 'Auth not configured on server' })
      return
    }

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username !== adminUser ||
      !(await bcrypt.compare(password, passwordHash))
    ) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const token = jwt.sign({ username }, jwtSecret, { expiresIn: '8h' })
    res.json({ token })
  } catch (err) {
    next(err)
  }
})

// GET /api/auth/me
router.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  const jwtSecret  = process.env.JWT_SECRET
  if (!authHeader?.startsWith('Bearer ') || !jwtSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { username: string }
    res.json({ username: payload.username })
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
})

export default router
