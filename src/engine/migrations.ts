import { PROJECT_SCHEMA_VERSION, projectSchema, type Project } from './model'

type Raw = Record<string, unknown>
type Migration = (raw: Raw) => Raw

const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {})
const rid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 16)

/**
 * migrations[n] upgrades a version-n project to version n + 1. Add one entry
 * whenever PROJECT_SCHEMA_VERSION goes up; never edit an old one.
 */
const migrations: Record<number, Migration> = {
  /**
   * 1 -> 2: video clips no longer play their own sound. Each video clip with
   * sound gets a linked audio clip on a new audio track, so nothing goes quiet.
   * Every sequence also gets a media-list item. New fields take defaults.
   */
  1: (raw) => {
    const media = obj(raw['media'])
    const sequences = obj(raw['sequences'])
    for (const seqRaw of Object.values(sequences)) {
      const seq = obj(seqRaw)
      const clips = obj(seq['clips'])
      const tracks = Array.isArray(seq['tracks']) ? (seq['tracks'] as Raw[]) : []
      const withSound = Object.values(clips)
        .map(obj)
        .filter((c) => {
          const track = tracks.find((t) => t['id'] === c['trackId'])
          const asset = obj(media[String(c['mediaId'])])
          return track?.['kind'] === 'video' && asset['hasAudio'] === true
        })
      if (withSound.length) {
        const audioCount = tracks.filter((t) => t['kind'] === 'audio').length
        const trackId = `trk_${rid()}`
        tracks.push({ id: trackId, kind: 'audio', name: `A${audioCount + 1}` })
        for (const clip of withSound) {
          const linkId = `lnk_${rid()}`
          clip['linkId'] = linkId
          const audioId = `clp_${rid()}`
          clips[audioId] = { ...clip, id: audioId, trackId, linkId }
        }
      }
      seq['tracks'] = tracks
      seq['clips'] = clips
      const video = tracks.find((t) => t['kind'] === 'video')
      const audio = tracks.find((t) => t['kind'] === 'audio')
      seq['targets'] = { video: video?.['id'] ?? null, audio: audio?.['id'] ?? null }
      const id = String(seq['id'])
      media[`med_${rid()}`] = {
        name: seq['name'],
        path: '',
        kind: 'sequence',
        duration: null,
        width: seq['width'],
        height: seq['height'],
        fps: seq['fps'],
        hasVideo: true,
        hasAudio: true,
        videoCodec: null,
        audioCodec: null,
        sampleRate: seq['sampleRate'],
        channels: 2,
        size: 0,
        importedAt: raw['createdAt'],
        sequenceId: id,
      }
    }
    for (const [mid, m] of Object.entries(media)) obj(m)['id'] = obj(m)['id'] ?? mid
    return { ...raw, media, sequences }
  },
  /** 2 -> 3: transforms, effects, masks, titles and transitions. Every new field has a default. */
  2: (raw) => raw,
  /** 3 -> 4: color grades and sequence color spaces, all with defaults. */
  3: (raw) => raw,
  /** 4 -> 5: clip sound, track and master buses, track roles, all with defaults. */
  4: (raw) => raw,
  /** 5 -> 6: captions, with defaults. */
  5: (raw) => raw,
  /** 6 -> 7: media ratings and tags, with defaults. */
  6: (raw) => raw,
}

export class ProjectFormatError extends Error {}

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object')
    throw new ProjectFormatError('The project file is empty or damaged.')
  let data = raw as Raw
  let version = Number(data['schemaVersion'])
  if (!Number.isInteger(version) || version < 1)
    throw new ProjectFormatError('The project file has no version number.')
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectFormatError(
      'This project was saved by a newer version of Lumacut. Update Lumacut to open it.',
    )
  }
  while (version < PROJECT_SCHEMA_VERSION) {
    const step = migrations[version]
    if (!step) throw new ProjectFormatError(`No upgrade path from project version ${version}.`)
    data = step(structuredClone(data))
    version++
    data['schemaVersion'] = version
  }
  const parsed = projectSchema.safeParse(data)
  if (!parsed.success)
    throw new ProjectFormatError(
      'The project file is damaged: some of its data is missing or invalid.',
    )
  return parsed.data
}
