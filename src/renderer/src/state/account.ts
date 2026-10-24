import { create } from 'zustand'
import type { Account } from '@shared/account'

type AccountState = {
  /** False when this build has no Google sign-in. */
  available: boolean
  account: Account | null
  signingIn: boolean
  error: string | null
}

export const useAccount = create<AccountState>(() => ({
  available: false,
  account: null,
  signingIn: false,
  error: null,
}))

let started = false

export function startAccount() {
  if (started) return
  started = true
  void window.lumacut.invoke('account:get').then((s) => useAccount.setState(s))
}

const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  )

export async function signIn() {
  useAccount.setState({ signingIn: true, error: null })
  try {
    const account = await window.lumacut.invoke('account:sign-in')
    useAccount.setState({ account, signingIn: false })
  } catch (error) {
    useAccount.setState({ signingIn: false, error: reason(error) })
  }
}

export function cancelSignIn() {
  void window.lumacut.invoke('account:cancel')
}

export async function signOut() {
  await window.lumacut.invoke('account:sign-out')
  useAccount.setState({ account: null, error: null })
}
