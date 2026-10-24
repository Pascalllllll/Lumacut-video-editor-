import { create } from 'zustand'

export type ConfirmChoice = 'save' | 'discard' | 'cancel'

type ConfirmRequest = { title: string; body: string; resolve: (choice: ConfirmChoice) => void }

export const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }))

/** Asks whether to save changes first. Resolves when the person picks an answer. */
export function askToSave(title: string, body: string): Promise<ConfirmChoice> {
  return new Promise((resolve) => {
    useConfirm.setState({
      request: {
        title,
        body,
        resolve: (choice) => {
          useConfirm.setState({ request: null })
          resolve(choice)
        },
      },
    })
  })
}
