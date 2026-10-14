import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AUTH_COOKIE_NAME, signSession } from '@/lib/auth'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect(
      new URL(`/groups?auth_error=${error || 'no_code'}`, origin)
    )
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = `${origin}/api/auth/callback/google`

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL('/groups?auth_error=google_credentials_missing', origin)
    )
  }

  try {
    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text()
      console.error('Google token exchange error:', errText)
      return NextResponse.redirect(new URL('/groups?auth_error=token_exchange_failed', origin))
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string
      id_token?: string
    }
    const accessToken = tokenData.access_token

    let googleId: string | undefined
    let email: string | undefined
    let name: string | undefined
    let image: string | undefined

    // 2a. Decode id_token JWT payload if available
    if (tokenData.id_token) {
      try {
        const parts = tokenData.id_token.split('.')
        if (parts[1]) {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf-8')
          ) as { sub?: string; email?: string; name?: string; picture?: string }
          if (payload.sub) googleId = payload.sub
          if (payload.email) email = payload.email
          if (payload.name) name = payload.name
          if (payload.picture) image = payload.picture
        }
      } catch (err) {
        console.warn('Could not decode id_token:', err)
      }
    }

    // 2b. Fetch user profile from Google userinfo API
    if (accessToken) {
      try {
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (userinfoRes.ok) {
          const prof = (await userinfoRes.json()) as {
            sub?: string
            email?: string
            name?: string
            picture?: string
          }
          if (prof.sub) googleId = prof.sub
          if (prof.email) email = prof.email
          if (prof.name) name = prof.name
          if (prof.picture) image = prof.picture
        }
      } catch (err) {
        console.warn('Google userinfo fetch failed:', err)
      }
    }

    if (!googleId || !email) {
      return NextResponse.redirect(new URL('/groups?auth_error=missing_profile_data', origin))
    }

    // 3. Upsert user in database
    const user = await prisma.user.upsert({
      where: { googleId },
      update: {
        email,
        name: name || undefined,
        image: image || undefined,
      },
      create: {
        googleId,
        email,
        name: name || undefined,
        image: image || undefined,
      },
    })

    // 4. Create signed session token
    const sessionToken = signSession({
      userId: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    })

    // 5. Set session cookie and redirect
    const response = NextResponse.redirect(new URL('/groups?auth=success', origin))
    response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    return response
  } catch (err) {
    console.error('Google OAuth callback failed:', err)
    return NextResponse.redirect(new URL('/groups?auth_error=internal_error', origin))
  }
}
