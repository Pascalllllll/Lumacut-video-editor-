import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ipcContract, type IpcChannel, type IpcParsedRequest, type IpcResponse } from '@shared/ipc'

type Handler<C extends IpcChannel> = (
  payload: IpcParsedRequest<C>,
  event: IpcMainInvokeEvent,
) => IpcResponse<C> | Promise<IpcResponse<C>>

export type IpcHandlers = { [C in IpcChannel]: Handler<C> }

export function registerIpc(
  handlers: IpcHandlers,
  isTrustedSender: (e: IpcMainInvokeEvent) => boolean,
) {
  for (const channel of Object.keys(ipcContract) as IpcChannel[]) {
    const spec = ipcContract[channel]
    const handler = handlers[channel] as Handler<typeof channel>
    ipcMain.handle(channel, async (event, raw: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Rejected IPC from an untrusted frame')
      const payload = spec.request.parse(raw) as IpcParsedRequest<typeof channel>
      const result = await handler(payload, event)
      return spec.response.parse(result)
    })
  }
}

export function windowFrom(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}
