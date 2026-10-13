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

    const tokenData = (await tokenResponse.json()) as { access_token?: string }
    const accessToken = tokenData.access_token

    // 2. Fetch user profile from Google
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!profileResponse.ok) {
      return NextResponse.redirect(new URL('/groups?auth_error=profile_fetch_failed', origin))
    }

    const profile = (await profileResponse.json()) as {
      sub: string
      email: string
      name?: string
      picture?: string
    }
    // profile contains { sub, email, name, picture, ... }
    const { sub: googleId, email, name, picture: image } = profile

    if (!email) {
      return NextResponse.redirect(new URL('/groups?auth_error=missing_email', origin))
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
