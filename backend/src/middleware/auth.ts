import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const jwtSecret  = process.env.JWT_SECRET
  if (!authHeader?.startsWith('Bearer ') || !jwtSecret) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), jwtSecret) as { username: string }
    ;(req as Request & { user: { username: string } }).user = { username: payload.username }
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized' })
  }
}
