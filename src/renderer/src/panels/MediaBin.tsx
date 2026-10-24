import { useMemo, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Menu from '@radix-ui/react-dropdown-menu'
import {
  AudioLines,
  Clapperboard,
  Film,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import { placeCommand } from '@engine/edits'
import { assetSeconds } from '@engine/media'
import { activeSequence, type MediaAsset } from '@engine/model'
import { clipsOnTrack, clipEnd } from '@engine/timeline'
import { t, td } from '../i18n'
import { Library } from './Library'
import {
  createMulticam,
  createProxies,
  importMedia,
  newSequence,
  openInSource,
} from '../lib/actions'
import { useThumbnail } from '../lib/media-cache'
import { collectFiles, locateMissing, relink } from '../lib/missing'
import { formatDuration } from '../lib/format'
import { EmptyState } from '../components/EmptyState'
import { IconButton } from '../components/IconButton'
import { Panel } from '../components/Panel'
import { useEditor } from '../state/editor'
import { notify } from '../state/notices'
import { selectProject, useProject } from '../state/project'
import { selectMedia, useSelectedMedia } from '../state/selection'
import menu from './timeline/Timeline.module.css'
import styles from './MediaBin.module.css'

export const MEDIA_DRAG_TYPE = 'application/x-lumacut-media'

export function filesFromDrop(event: DragEvent): string[] {
  return Array.from(event.dataTransfer.files)
    .map((f) => window.lumacut.pathForFile(f))
    .filter(Boolean)
}

/** Adds a media item at the end of the target tracks. */
export function appendToTimeline(asset: MediaAsset) {
  const state = useProject.getState()
  const project = state.history.project
  const seq = activeSequence(project)
  if (asset.kind === 'sequence' && asset.sequenceId === seq.id) {
    notify('error', t('errors.selfNest'))
    return
  }
  const trackIds = [seq.targets.video, seq.targets.audio].filter(Boolean) as string[]
  const end = trackIds
    .flatMap((id) => clipsOnTrack(seq, id))
    .reduce((max, c) => Math.max(max, clipEnd(c)), 0)
  try {
    state.dispatch(placeCommand(project, seq, asset, end))
  } catch (error) {
    notify('error', error instanceof Error ? error.message : String(error))
  }
}

export function MediaBin() {
  const project = useProject(selectProject)
  const importing = useProject((s) => s.importing)
  const [query, setQuery] = useState('')
  const [dropping, setDropping] = useState(false)
  const [tab, setTab] = useState<'media' | 'effects' | 'transitions' | 'generators'>('media')
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const missing = useEditor((s) => s.missing)
  const used = useMemo(
    () =>
      new Set(
        Object.values(project.sequences).flatMap((s) =>
          Object.values(s.clips).map((c) => c.mediaId),
        ),
      ),
    [project.sequences],
  )
  const assets = useMemo(() => {
    const all = Object.values(project.media).sort((a, b) =>
      (a.kind === 'sequence') === (b.kind === 'sequence')
        ? a.importedAt.localeCompare(b.importedAt)
        : a.kind === 'sequence'
          ? -1
          : 1,
    )
    const q = query.trim().toLowerCase()
    return all
      .filter((a) => FILTERS[filter](a, { used, missing }))
      .filter(
        (a) =>
          !q ||
          a.name.toLowerCase().includes(q) ||
          a.tags.some((tag) => tag.toLowerCase().includes(q)),
      )
  }, [project.media, query, filter, used, missing])
  const files = Object.values(project.media).filter((m) => m.kind !== 'sequence').length

  return (
    <Panel.Root label={t('panel.media')} area="media">
      <Panel.Header>
        <div className={styles.tabs} role="tablist" aria-label={t('library.tabs')}>
          {(['media', 'effects', 'transitions', 'generators'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={styles.tab}
              onClick={() => setTab(k)}
            >
              {td(`library.tab.${k}`)}
            </button>
          ))}
        </div>
        <div className={styles.headerButtons} hidden={tab !== 'media'}>
          <IconButton
            label={t('media.newSequence')}
            onClick={newSequence}
            className={styles.headerButton}
          >
            <Clapperboard size={15} strokeWidth={1.6} />
          </IconButton>
          <IconButton
            label={t('media.import')}
            onClick={() => void importMedia()}
            className={styles.headerButton}
          >
            <Plus size={15} strokeWidth={1.6} />
          </IconButton>
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton label={t('media.more')} className={styles.headerButton}>
                <MoreHorizontal size={15} strokeWidth={1.6} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content className={menu.menu} align="end">
                <Menu.RadioGroup value={view} onValueChange={(v) => setView(v as 'grid' | 'list')}>
                  <Menu.RadioItem value="grid" className={menu.menuItem}>
                    {t('media.viewGrid')}
                  </Menu.RadioItem>
                  <Menu.RadioItem value="list" className={menu.menuItem}>
                    {t('media.viewList')}
                  </Menu.RadioItem>
                </Menu.RadioGroup>
                <Menu.Separator className={menu.menuSeparator} />
                <Menu.Item className={menu.menuItem} onSelect={() => void locateMissing()}>
                  {t('media.locate')}
                </Menu.Item>
                <Menu.Item className={menu.menuItem} onSelect={() => void collectFiles()}>
                  {t('media.collectMenu')}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </Panel.Header>
      {tab !== 'media' ? (
        <Panel.Body>
          <Library kind={tab} />
        </Panel.Body>
      ) : null}
      <div className={styles.searchRow} hidden={tab !== 'media'}>
        <input
          type="search"
          className={styles.search}
          placeholder={t('media.search')}
          aria-label={t('media.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.filters} role="group" aria-label={t('media.filter')}>
          {(Object.keys(FILTERS) as Filter[])
            .filter((f) => f !== 'missing' || Object.keys(missing).length > 0)
            .map((f) => (
              <button
                key={f}
                type="button"
                className={styles.filter}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {td(`media.filters.${f}`)}
              </button>
            ))}
        </div>
      </div>
      <Panel.Body hidden={tab !== 'media'}>
        <div
          className={styles.drop}
          data-dropping={dropping}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault()
              setDropping(true)
            }
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDropping(false)
            const paths = filesFromDrop(e)
            if (paths.length) void importMedia(paths)
          }}
        >
          <ul className={styles.grid} data-view={view} aria-label={t('panel.media')}>
            {assets.map((asset) => (
              <MediaCard key={asset.id} asset={asset} missing={Boolean(missing[asset.path])} />
            ))}
            {importing > 0 ? (
              <li className={`${styles.card} ${styles.skeleton}`} aria-label={t('media.importing')}>
                <div className={styles.thumb} />
                <div className={styles.meta}>
                  <span className={styles.name}>{t('media.importing')}</span>
                </div>
              </li>
            ) : null}
            {(query || filter !== 'all') && assets.length === 0 ? (
              <li className={styles.noMatch}>{t('media.noMatch', { query })}</li>
            ) : null}
          </ul>
          {files === 0 && importing === 0 && !query ? (
            <EmptyState
              title={t('empty.media.title')}
              body={t('empty.media.bodyReady')}
              action={
                <button
                  type="button"
                  className={styles.importButton}
                  onClick={() => void importMedia()}
                >
                  {t('media.import')}
                </button>
              }
            />
          ) : null}
        </div>
      </Panel.Body>
    </Panel.Root>
  )
}

type Filter = 'all' | 'video' | 'audio' | 'image' | 'sequence' | 'rated' | 'unused' | 'missing'
type FilterContext = { used: Set<string>; missing: Record<string, true> }

/** The media list's built-in smart bins. */
const FILTERS: Record<Filter, (a: MediaAsset, c: FilterContext) => boolean> = {
  all: () => true,
  video: (a) => a.kind === 'video',
  audio: (a) => a.kind === 'audio',
  image: (a) => a.kind === 'image',
  sequence: (a) => a.kind === 'sequence',
  rated: (a) => a.rating > 0,
  unused: (a, c) => a.kind !== 'sequence' && !c.used.has(a.id),
  missing: (a, c) => Boolean(c.missing[a.path]),
}

function MediaCard({ asset, missing }: { asset: MediaAsset; missing: boolean }) {
  const project = useProject(selectProject)
  const thumb = useThumbnail(asset.kind === 'sequence' ? undefined : asset)
  const selected = useSelectedMedia((s) => s.mediaIds.includes(asset.id))
  const selectedIds = useSelectedMedia((s) => s.mediaIds)
  const proxy = useEditor((s) => s.proxies[asset.path])
  const progress = useEditor((s) => s.proxyProgress[asset.path])
  const dispatch = useProject((s) => s.dispatch)
  const isOpenSequence = asset.kind === 'sequence' && asset.sequenceId === project.activeSequenceId
  const seconds = assetSeconds(project, asset)
  const [renaming, setRenaming] = useState(false)
  const [tagging, setTagging] = useState(false)

  const remove = () =>
    dispatch({ type: 'media.remove', mediaIds: selected ? selectedIds : [asset.id] })
  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming) return
    if (e.key === 'Enter') openInSource(asset.id)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.stopPropagation()
      remove()
    }
  }
  const onClick = (e: MouseEvent) =>
    selectMedia(asset.id, e.ctrlKey || e.metaKey || e.shiftKey ? 'toggle' : 'replace')
  const videosSelected = selectedIds.filter((id) => project.media[id]?.kind === 'video').length

  return (
    <ContextMenu.Root onOpenChange={(open) => open && !selected && selectMedia(asset.id)}>
      <ContextMenu.Trigger asChild>
        <li
          className={styles.card}
          data-selected={selected}
          tabIndex={0}
          aria-label={asset.name}
          aria-current={selected ? 'true' : undefined}
          draggable={!renaming}
          onDragStart={(e) => {
            e.dataTransfer.setData(MEDIA_DRAG_TYPE, asset.id)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={onClick}
          onDoubleClick={() => openInSource(asset.id)}
          onKeyDown={onKeyDown}
          data-missing={missing}
          title={asset.kind === 'sequence' ? t('media.sequenceHint') : t('media.cardHint')}
        >
          <div className={styles.thumb} data-kind={asset.kind}>
            {thumb ? <img src={thumb} alt="" draggable={false} /> : null}
            {asset.kind === 'audio' ? (
              <AudioLines size={22} strokeWidth={1.4} aria-hidden="true" />
            ) : null}
            {asset.kind === 'sequence' ? (
              <Film size={22} strokeWidth={1.4} aria-hidden="true" />
            ) : null}
            {asset.kind === 'image' && thumb === null ? (
              <ImageIcon size={22} strokeWidth={1.4} aria-hidden="true" />
            ) : null}
            {seconds !== null ? (
              <span className={`${styles.badge} tabular`}>{formatDuration(seconds)}</span>
            ) : null}
            {missing ? (
              <span className={`${styles.badge} ${styles.badgeLeft} ${styles.badgeMissing}`}>
                {t('media.missing')}
              </span>
            ) : proxy ? (
              <span className={`${styles.badge} ${styles.badgeLeft}`}>{t('media.proxyBadge')}</span>
            ) : null}
            {progress !== undefined && !proxy ? (
              <span className={`${styles.badge} ${styles.badgeLeft} tabular`}>
                {t('media.proxyProgress', { pct: Math.round(progress * 100) })}
              </span>
            ) : null}
          </div>
          <div className={styles.meta}>
            {renaming ? (
              <input
                className={styles.rename}
                defaultValue={asset.name}
                autoFocus
                aria-label={t('media.rename')}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setRenaming(false)
                  const name = e.target.value.trim()
                  if (name && name !== asset.name)
                    dispatch({ type: 'media.update', mediaId: asset.id, patch: { name } })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
            ) : (
              <span className={styles.name}>
                {asset.name}
                {isOpenSequence ? (
                  <span className={styles.open}> · {t('media.openNow')}</span>
                ) : null}
              </span>
            )}
            {asset.rating > 0 ? (
              <span className={styles.stars} aria-label={t('media.stars', { count: asset.rating })}>
                {'\u2605'.repeat(asset.rating)}
              </span>
            ) : null}
            {tagging ? (
              <input
                className={styles.rename}
                defaultValue={asset.tags.join(', ')}
                autoFocus
                aria-label={t('media.tagsLabel')}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setTagging(false)
                  const tags = [
                    ...new Set(
                      e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ]
                  if (tags.join(',') !== asset.tags.join(','))
                    dispatch({ type: 'media.update', mediaId: asset.id, patch: { tags } })
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setTagging(false)
                }}
              />
            ) : asset.tags.length ? (
              <span className={styles.tags}>{asset.tags.join(', ')}</span>
            ) : null}
          </div>
        </li>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menu.menu}>
          <ContextMenu.Item className={menu.menuItem} onSelect={() => openInSource(asset.id)}>
            {asset.kind === 'sequence' ? t('media.openSequence') : t('media.openSource')}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={menu.menuItem}
            disabled={isOpenSequence}
            onSelect={() => appendToTimeline(asset)}
          >
            {t('media.append')}
          </ContextMenu.Item>
          <ContextMenu.Separator className={menu.menuSeparator} />
          {asset.kind === 'video' ? (
            <ContextMenu.Item
              className={menu.menuItem}
              disabled={Boolean(proxy)}
              onSelect={() =>
                createProxies(
                  selectedIds
                    .map((id) => project.media[id])
                    .filter((a): a is MediaAsset => Boolean(a)),
                )
              }
            >
              {t('media.createProxy')}
            </ContextMenu.Item>
          ) : null}
          {videosSelected >= 2 ? (
            <ContextMenu.Item
              className={menu.menuItem}
              onSelect={() => void createMulticam(selectedIds)}
            >
              {t('media.multicam', { count: videosSelected })}
            </ContextMenu.Item>
          ) : null}
          {missing ? (
            <ContextMenu.Item className={menu.menuItem} onSelect={() => void relink(asset)}>
              {t('media.relink')}
            </ContextMenu.Item>
          ) : null}
          <ContextMenu.Item className={menu.menuItem} onSelect={() => setRenaming(true)}>
            {t('media.rename')}
          </ContextMenu.Item>
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={menu.menuItem}>
              {t('media.rating')}
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={menu.menu}>
                <ContextMenu.RadioGroup
                  value={String(asset.rating)}
                  onValueChange={(v) =>
                    dispatch({
                      type: 'media.update',
                      mediaId: asset.id,
                      patch: { rating: Number(v) },
                    })
                  }
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <ContextMenu.RadioItem key={n} value={String(n)} className={menu.menuItem}>
                      {n === 0 ? t('media.noRating') : t('media.stars', { count: n })}
                    </ContextMenu.RadioItem>
                  ))}
                </ContextMenu.RadioGroup>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Item className={menu.menuItem} onSelect={() => setTagging(true)}>
            {t('media.tags')}
          </ContextMenu.Item>
          <ContextMenu.Item className={menu.menuItem} disabled={isOpenSequence} onSelect={remove}>
            {t('media.remove')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
