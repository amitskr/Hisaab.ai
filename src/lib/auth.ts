import { prisma } from '@/lib/prisma'
import crypto from 'node:crypto'
import { cookies } from 'next/headers'

const AUTH_COOKIE_NAME = 'hisaab_session'
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  process.env.CRON_SECRET ||
  'hisaab-ai-super-secret-auth-key-2026'

export type SessionPayload = {
  userId: string
  email: string
  name?: string | null
  image?: string | null
  exp: number
}

/**
 * Sign session payload with HMAC-SHA256
 */
export function signSession(payload: Omit<SessionPayload, 'exp'>, expiresInDays = 30): string {
  const exp = Date.now() + expiresInDays * 24 * 60 * 60 * 1000
  const fullPayload: SessionPayload = { ...payload, exp }
  const data = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(data)
    .digest('base64url')
  return `${data}.${signature}`
}

/**
 * Verify and decode session token
 */
export function verifySession(token: string): SessionPayload | null {
  try {
    const [data, signature] = token.split('.')
    if (!data || !signature) return null

    const expectedSignature = crypto
      .createHmac('sha256', AUTH_SECRET)
      .update(data)
      .digest('base64url')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null
    }

    const payload = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf-8')
    ) as SessionPayload

    if (Date.now() > payload.exp) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

/**
 * Get currently authenticated user from Next.js cookies
 */
export async function getSessionUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value
  if (!token) return null

  const payload = verifySession(token)
  if (!payload) return null

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
      },
    })
    return user
  } catch {
    return null
  }
}

export { AUTH_COOKIE_NAME }
