import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  authUrl,
  GOOGLE,
  isTrustedPictureUrl,
  pkcePair,
  randomState,
  readCallback,
} from '../../src/main/oauth'
import { RecentProjects } from '../../src/main/recent'
import { projectFromArgs } from '../../src/shared/recent'

describe('PKCE', () => {
  it('sends the SHA-256 of a long random verifier', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(pkcePair().verifier).not.toBe(verifier)
    expect(randomState()).not.toBe(randomState())
  })

  it('asks Google only for the basic profile, with S256 and a loopback redirect', () => {
    const url = new URL(
      authUrl(GOOGLE, {
        clientId: 'id.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:5000/callback',
        challenge: 'abc',
        state: 'xyz',
      }),
    )
    expect(url.origin).toBe('https://accounts.google.com')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: 'openid email profile',
      response_type: 'code',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'xyz',
      redirect_uri: 'http://127.0.0.1:5000/callback',
    })
  })
})

describe('the redirect', () => {
  it('gives the code only with the right path and state', () => {
    expect(readCallback('/callback?code=c1&state=s1', 's1')).toEqual({ code: 'c1' })
    expect(readCallback('/callback?code=c1&state=other', 's1')).toEqual({
      error: 'state-mismatch',
    })
    expect(readCallback('/favicon.ico', 's1')).toEqual({ error: 'wrong-path' })
    expect(readCallback('/callback?state=s1', 's1')).toEqual({ error: 'no-code' })
    expect(readCallback('/callback?error=access_denied&state=s1', 's1')).toEqual({
      error: 'access_denied',
    })
  })

  it('fetches a picture only from Google over HTTPS', () => {
    expect(isTrustedPictureUrl('https://lh3.googleusercontent.com/a/x=s96-c')).toBe(true)
    expect(isTrustedPictureUrl('http://lh3.googleusercontent.com/a/x')).toBe(false)
    expect(isTrustedPictureUrl('https://evil.com/googleusercontent.com')).toBe(false)
    expect(isTrustedPictureUrl('https://googleusercontent.com.evil.com/a')).toBe(false)
    expect(isTrustedPictureUrl('file:///etc/passwd')).toBe(false)
  })
})

describe('recent projects', () => {
  it('keeps the newest first, without duplicates, and notices missing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumacut-recent-'))
    const store = new RecentProjects(dir)
    await store.load()
    await store.add('/nowhere/a.lumacut', 'A')
    await store.add('/nowhere/b.lumacut', 'B')
    await store.add('/nowhere/a.lumacut', 'A again')
    const reloaded = new RecentProjects(dir)
    await reloaded.load()
    const list = await reloaded.list()
    expect(list.map((p) => p.name)).toEqual(['A again', 'B'])
    expect(list.every((p) => !p.exists)).toBe(true)
    await reloaded.remove('/nowhere/b.lumacut')
    expect((await reloaded.list()).map((p) => p.name)).toEqual(['A again'])
  })

  it('finds a project file among the launch arguments', () => {
    expect(projectFromArgs(['lumacut', '--no-sandbox', '/home/a/Film.lumacut'], 'lumacut')).toBe(
      '/home/a/Film.lumacut',
    )
    expect(projectFromArgs(['electron', '.'], 'lumacut')).toBeNull()
    expect(projectFromArgs(['lumacut', 'notes.txt'], 'lumacut')).toBeNull()
  })
})
