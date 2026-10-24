import { createHash, randomBytes } from 'node:crypto'

/**
 * OAuth 2.0 for installed apps (RFC 8252) with PKCE (RFC 7636): the browser
 * signs in, Google redirects to a one-time server on 127.0.0.1, and the code
 * is exchanged for tokens using a secret that never left this computer.
 */
export type OAuthEndpoints = { auth: string; token: string; userinfo: string; revoke: string }

export const GOOGLE: OAuthEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  revoke: 'https://oauth2.googleapis.com/revoke',
}

const base64url = (b: Buffer) => b.toString('base64url')

export function pkcePair() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export const randomState = () => base64url(randomBytes(24))

export function authUrl(
  endpoints: OAuthEndpoints,
  p: { clientId: string; redirectUri: string; challenge: string; state: string },
): string {
  const url = new URL(endpoints.auth)
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    prompt: 'select_account',
  }).toString()
  return url.toString()
}

/** The code from the redirect, or why there isn't one. */
export function readCallback(
  requestUrl: string,
  expectedState: string,
): { code: string } | { error: string } {
  const url = new URL(requestUrl, 'http://127.0.0.1')
  if (url.pathname !== '/callback') return { error: 'wrong-path' }
  if (url.searchParams.get('state') !== expectedState) return { error: 'state-mismatch' }
  const error = url.searchParams.get('error')
  if (error) return { error }
  const code = url.searchParams.get('code')
  return code ? { code } : { error: 'no-code' }
}

/** Only Google's own picture hosts, over HTTPS, are fetched for the avatar. */
export function isTrustedPictureUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(url.hostname)
  } catch {
    return false
  }
}
