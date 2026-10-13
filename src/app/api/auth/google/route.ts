import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const url = new URL(request.url)
  const origin = url.origin

  if (!clientId) {
    // Graceful fallback if Google OAuth credentials have not been added to env yet
    return NextResponse.redirect(
      new URL('/groups?auth_error=google_credentials_missing', origin)
    )
  }

  const redirectUri = `${origin}/api/auth/callback/google`
  const state = Math.random().toString(36).substring(2)

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  googleAuthUrl.searchParams.set('client_id', clientId)
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri)
  googleAuthUrl.searchParams.set('response_type', 'code')
  googleAuthUrl.searchParams.set('scope', 'openid email profile')
  googleAuthUrl.searchParams.set('prompt', 'select_account')
  googleAuthUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(googleAuthUrl)
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/',
  })

  return response
}
