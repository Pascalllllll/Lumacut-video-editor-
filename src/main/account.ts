import { createServer, type Server } from 'node:http'
import { readFile, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { z } from 'zod'
import { accountSchema, type Account } from '@shared/account'
import {
  authUrl,
  GOOGLE,
  isTrustedPictureUrl,
  pkcePair,
  randomState,
  readCallback,
  type OAuthEndpoints,
} from './oauth'

const TIMEOUT = 5 * 60 * 1000
const MAX_PICTURE = 256 * 1024

const tokenSchema = z.object({ access_token: z.string().min(1) })
const profileSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  picture: z.string().max(2000).optional(),
})

type Config = { clientId: string; clientSecret: string; endpoints: OAuthEndpoints }

/** The page the browser shows after the redirect. It loads nothing. */
function page(title: string, body: string) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui,sans-serif;max-width:32em;margin:20vh auto;padding:0 1em;color:#222}h1{font-size:20px}</style>
<h1>${title}</h1><p>${body}</p>`
}

/**
 * Optional sign-in with a Google account. It only reads the name, email
 * address and picture to show in Lumacut; the tokens are revoked right after
 * and nothing is kept but those three things.
 */
export class AccountService {
  private readonly file: string
  private pending: { cancel: () => void } | null = null

  constructor(dir: string) {
    this.file = join(dir, 'account.json')
  }

  private config(): Config | null {
    // Development and tests may point at their own client and server; packaged builds can't.
    const dev = !app.isPackaged
    const clientId = (dev && process.env['LUMACUT_GOOGLE_CLIENT_ID']) || __GOOGLE_CLIENT_ID__
    if (!clientId) return null
    const clientSecret =
      (dev && process.env['LUMACUT_GOOGLE_CLIENT_SECRET']) || __GOOGLE_CLIENT_SECRET__
    const base = dev ? process.env['LUMACUT_OAUTH_BASE'] : undefined
    const endpoints = base
      ? {
          auth: `${base}/auth`,
          token: `${base}/token`,
          userinfo: `${base}/userinfo`,
          revoke: `${base}/revoke`,
        }
      : GOOGLE
    return { clientId, clientSecret, endpoints }
  }

  available() {
    return this.config() !== null
  }

  async get(): Promise<Account | null> {
    try {
      const parsed = accountSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async signOut() {
    this.cancel()
    await rm(this.file, { force: true })
  }

  cancel() {
    this.pending?.cancel()
    this.pending = null
  }

  async signIn(): Promise<Account> {
    const config = this.config()
    if (!config) throw new Error('This copy of Lumacut was built without Google sign-in.')
    this.cancel()
    const { verifier, challenge } = pkcePair()
    const state = randomState()
    const { code, redirectUri } = await this.waitForCode(config, challenge, state)

    const tokenRes = await fetch(config.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) throw new Error(`Google didn't accept the sign-in (${tokenRes.status}).`)
    const { access_token: token } = tokenSchema.parse(await tokenRes.json())

    try {
      const profileRes = await fetch(config.endpoints.userinfo, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!profileRes.ok)
        throw new Error(`Couldn't read the Google profile (${profileRes.status}).`)
      const profile = profileSchema.parse(await profileRes.json())
      const account: Account = {
        provider: 'google',
        name: profile.name || profile.email || 'Google account',
        email: profile.email ?? '',
        picture: profile.picture ? await fetchPicture(profile.picture) : null,
        signedInAt: Date.now(),
      }
      await writeFile(this.file, JSON.stringify(account), { mode: 0o600 })
      return account
    } finally {
      // Lumacut has what it needs; the access token shouldn't stay valid.
      void fetch(config.endpoints.revoke, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      }).catch(() => undefined)
    }
  }

  private waitForCode(config: Config, challenge: string, state: string) {
    return new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      let server: Server | null = null
      let redirectUri = ''
      const finish = (error: Error | null, code?: string) => {
        clearTimeout(timer)
        this.pending = null
        server?.close()
        server?.closeAllConnections()
        if (error) reject(error)
        else resolve({ code: code!, redirectUri })
      }
      const timer = setTimeout(
        () => finish(new Error('Sign-in took too long. Try again.')),
        TIMEOUT,
      )
      this.pending = { cancel: () => finish(new Error('Sign-in was cancelled.')) }

      server = createServer((req, res) => {
        const reply = (status: number, title: string, body: string) => {
          res.writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
            'Cache-Control': 'no-store',
          })
          res.end(page(title, body))
        }
        const result = readCallback(req.url ?? '/', state)
        if ('code' in result) {
          reply(200, 'You’re signed in', 'You can close this tab and go back to Lumacut.')
          finish(null, result.code)
        } else if (result.error === 'wrong-path' || result.error === 'state-mismatch') {
          // Anything that isn't Google's redirect for this sign-in is ignored.
          reply(404, 'Not found', 'This address is only used while signing in to Lumacut.')
        } else {
          reply(400, 'Sign-in didn’t finish', 'Go back to Lumacut and try again.')
          finish(
            new Error(
              result.error === 'access_denied'
                ? 'Sign-in was cancelled in the browser.'
                : `Google reported an error: ${result.error}.`,
            ),
          )
        }
      })
      server.on('error', (error) => finish(error))
      server.listen(0, '127.0.0.1', () => {
        const { port } = server!.address() as AddressInfo
        redirectUri = `http://127.0.0.1:${port}/callback`
        void shell
          .openExternal(
            authUrl(config.endpoints, { clientId: config.clientId, redirectUri, challenge, state }),
          )
          .catch((error: Error) => finish(error))
      })
    })
  }
}

async function fetchPicture(url: string): Promise<string | null> {
  if (!isTrustedPictureUrl(url)) return null
  try {
    const res = await fetch(url, { redirect: 'error' })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type.split(';')[0]!)) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_PICTURE) return null
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}
