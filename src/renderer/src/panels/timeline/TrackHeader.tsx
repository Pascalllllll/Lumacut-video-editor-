import { useState } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX } from 'lucide-react'
import { createTrack, type Sequence, type Track } from '@engine/model'
import { t } from '../../i18n'
import { useProject } from '../../state/project'
import { trackHeight } from './geometry'
import styles from './Timeline.module.css'

const ICON = { size: 13, strokeWidth: 1.7 } as const

export function TrackHeader({ track, sequence }: { track: Track; sequence: Sequence }) {
  const dispatch = useProject((s) => s.dispatch)
  const [renaming, setRenaming] = useState(false)
  const update = (patch: Partial<Track>) =>
    dispatch({ type: 'track.update', sequenceId: sequence.id, trackId: track.id, patch })
  const targeted =
    track.kind === 'video'
      ? sequence.targets.video === track.id
      : sequence.targets.audio === track.id
  const setTarget = () =>
    dispatch({
      type: 'sequence.settings',
      sequenceId: sequence.id,
      targets: { ...sequence.targets, [track.kind]: targeted ? null : track.id },
    })
  const addTrack = (kind: Track['kind']) => {
    const count = sequence.tracks.filter((tr) => tr.kind === kind).length
    dispatch({
      type: 'track.add',
      sequenceId: sequence.id,
      track: createTrack(kind, `${kind === 'video' ? 'V' : 'A'}${count + 1}`),
    })
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={styles.trackHeader}
          style={{ height: trackHeight(track) }}
          data-kind={track.kind}
          data-locked={track.locked}
        >
          <button
            type="button"
            className={styles.target}
            data-on={targeted}
            onClick={setTarget}
            aria-pressed={targeted}
            aria-label={t('track.target', { name: track.name })}
            title={t('track.targetHint')}
          >
            {track.kind === 'video' ? 'V' : 'A'}
          </button>
          {renaming ? (
            <input
              className={styles.trackName}
              defaultValue={track.name}
              autoFocus
              aria-label={t('track.rename')}
              onBlur={(e) => {
                setRenaming(false)
                const name = e.target.value.trim()
                if (name && name !== track.name) update({ name })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <span
              className={styles.trackName}
              onDoubleClick={() => setRenaming(true)}
              title={t('track.renameHint')}
            >
              {track.name}
            </span>
          )}
          <div className={styles.trackButtons}>
            <button
              type="button"
              aria-pressed={track.locked}
              aria-label={
                track.locked
                  ? t('track.unlock', { name: track.name })
                  : t('track.lock', { name: track.name })
              }
              data-on={track.locked}
              onClick={() => update({ locked: !track.locked })}
            >
              {track.locked ? <Lock {...ICON} /> : <LockOpen {...ICON} />}
            </button>
            {track.kind === 'video' ? (
              <button
                type="button"
                aria-pressed={track.hidden}
                aria-label={
                  track.hidden
                    ? t('track.show', { name: track.name })
                    : t('track.hide', { name: track.name })
                }
                data-on={track.hidden}
                onClick={() => update({ hidden: !track.hidden })}
              >
                {track.hidden ? <EyeOff {...ICON} /> : <Eye {...ICON} />}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  aria-pressed={track.muted}
                  aria-label={
                    track.muted
                      ? t('track.unmute', { name: track.name })
                      : t('track.mute', { name: track.name })
                  }
                  data-on={track.muted}
                  onClick={() => update({ muted: !track.muted })}
                >
                  {track.muted ? <VolumeX {...ICON} /> : <Volume2 {...ICON} />}
                </button>
                <button
                  type="button"
                  className={styles.solo}
                  aria-pressed={track.solo}
                  aria-label={t('track.solo', { name: track.name })}
                  data-on={track.solo}
                  onClick={() => update({ solo: !track.solo })}
                >
                  S
                </button>
              </>
            )}
          </div>
          <div
            className={styles.resize}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('track.resize', { name: track.name })}
            onPointerDown={(e) => {
              e.preventDefault()
              const startY = e.clientY
              const startH = trackHeight(track)
              const el = e.currentTarget.parentElement as HTMLElement | null
              let next = startH
              const move = (ev: PointerEvent) => {
                next = Math.min(240, Math.max(24, startH + ev.clientY - startY))
                if (el) el.style.height = `${next}px`
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                if (next !== startH) update({ height: next })
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={styles.menu}>
          <ContextMenu.Item className={styles.menuItem} onSelect={() => addTrack('video')}>
            {t('track.addVideo')}
          </ContextMenu.Item>
          <ContextMenu.Item className={styles.menuItem} onSelect={() => addTrack('audio')}>
            {t('track.addAudio')}
          </ContextMenu.Item>
          <ContextMenu.Separator className={styles.menuSeparator} />
          <ContextMenu.Item className={styles.menuItem} onSelect={() => setRenaming(true)}>
            {t('track.rename')}
          </ContextMenu.Item>
          <ContextMenu.Item className={styles.menuItem} onSelect={() => update({ height: null })}>
            {t('track.resetHeight')}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={styles.menuItem}
            onSelect={() =>
              dispatch({ type: 'track.remove', sequenceId: sequence.id, trackId: track.id })
            }
          >
            {t('track.delete', { name: track.name })}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
