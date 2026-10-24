import { z } from 'zod'

export const accountSchema = z.object({
  provider: z.literal('google'),
  name: z.string().max(200),
  email: z.string().max(320),
  /** A small copy of the profile picture as a data URL, so nothing loads from the internet later. */
  picture: z.string().max(400_000).nullable(),
  signedInAt: z.number(),
})
export type Account = z.infer<typeof accountSchema>
