import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  ipcContract,
  ipcEvents,
  type IpcChannel,
  type IpcEventName,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
} from '@shared/ipc'

async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcRequest<C> extends void ? [] : [IpcRequest<C>]
): Promise<IpcResponse<C>> {
  const spec = ipcContract[channel]
  if (!spec) throw new Error(`Unknown channel: ${String(channel)}`)
  const payload = spec.request.parse(args[0])
  const result: unknown = await ipcRenderer.invoke(channel, payload)
  return spec.response.parse(result) as IpcResponse<C>
}

function on<E extends IpcEventName>(event: E, listener: (payload: IpcEventPayload<E>) => void) {
  const schema = ipcEvents[event]
  const wrapped = (_e: IpcRendererEvent, raw: unknown) => {
    const parsed = schema.safeParse(raw)
    if (parsed.success) listener(parsed.data as IpcEventPayload<E>)
  }
  ipcRenderer.on(event, wrapped)
  return () => {
    ipcRenderer.removeListener(event, wrapped)
  }
}

/** Dropped files only expose their path through webUtils under context isolation. */
function pathForFile(file: File): string {
  return webUtils.getPathForFile(file)
}

const api = { invoke, on, pathForFile, platform: process.platform }
export type LumacutApi = typeof api

contextBridge.exposeInMainWorld('lumacut', api)
