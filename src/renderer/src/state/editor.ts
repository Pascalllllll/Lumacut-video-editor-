import { create } from 'zustand'

import type { ParamPath } from '@engine/look'

export type Tool = 'select' | 'blade' | 'ripple' | 'roll' | 'slip' | 'slide' | 'rate'

export const TOOLS: { id: Tool; key: string }[] = [
  { id: 'select', key: 'V' },
  { id: 'blade', key: 'C' },
  { id: 'ripple', key: 'B' },
  { id: 'roll', key: 'N' },
  { id: 'slip', key: 'Y' },
  { id: 'slide', key: 'U' },
  { id: 'rate', key: 'R' },
]

type EditorState = {
  tool: Tool
  /** Which picture the viewer shows. */
  viewer: 'timeline' | 'source'
  /** Media item loaded in the source viewer. */
  sourceMediaId: string | null
  /** Seconds into the source item. */
  sourceTime: number
  /** Proxy file names by original path; null when there is no proxy. */
  proxies: Record<string, string | null>
  proxyProgress: Record<string, number>
  /** The animated value shown in the graph editor. */
  selectedParam: { clipId: string; path: ParamPath } | null
  /** Drawing a new mask in the viewer. */
  maskTool: 'none' | 'rectangle' | 'ellipse' | 'path'
  /** Which inspector tab a selected clip shows. */
  inspectorTab: 'clip' | 'look' | 'title' | 'sound'
  settingsOpen: boolean
  palette: boolean
  /** The start screen with recent projects, in place of the workspace. */
  home: boolean
  /** The guided tour's current step, or null when it isn't running. */
  tour: number | null
  /** Media files that can't be found, by path. */
  missing: Record<string, true>
}

export const useEditor = create<EditorState>(() => ({
  tool: 'select',
  viewer: 'timeline',
  sourceMediaId: null,
  sourceTime: 0,
  proxies: {},
  proxyProgress: {},
  selectedParam: null,
  maskTool: 'none',
  inspectorTab: 'clip',
  settingsOpen: false,
  palette: false,
  home: false,
  tour: null,
  missing: {},
}))
