import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

declare global {
  namespace Express {
    interface Request {
      isAdmin?: boolean
    }
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.isAdmin = false
  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) { next(); return }

  let token: string | null = null
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7)
  // Fallback: ?token= query param — used by Cesium tile fetches that can't set headers
  else if (typeof req.query.token === 'string') token = req.query.token

  if (!token) { next(); return }
  try {
    jwt.verify(token, jwtSecret)
    req.isAdmin = true
  } catch {
    // invalid token — treat as anonymous
  }
  next()
}
