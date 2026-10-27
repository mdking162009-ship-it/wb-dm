import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface DownloadItemInfo {
  id: string
  url: string
  filename: string
  category: string
  savePath: string
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  speed: number
  error?: string
}

export interface LinkGuess {
  url: string
  filename: string
  ext: string
  category: string
}

export interface AppSettingsInfo {
  subfolders: boolean
  askSave: boolean
  maxConcurrent: number
  segments: number
  captureClipboard: boolean
  captureAutoDownload: boolean
  checkUpdates: boolean
}

const api = {
  windowMinimize: (): void => ipcRenderer.send('window:minimize'),
  windowMaximize: (): void => ipcRenderer.send('window:maximize'),
  windowClose: (): void => ipcRenderer.send('window:close'),
  addDownloads: (urls: string) => ipcRenderer.invoke('downloads:add', urls),
  getFolder: (): Promise<string> => ipcRenderer.invoke('downloads:get-folder'),
  getItems: (): Promise<DownloadItemInfo[]> => ipcRenderer.invoke('downloads:get-items'),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('downloads:choose-folder'),
  clearFinished: (): Promise<void> => ipcRenderer.invoke('downloads:clear-finished'),
  openFolder: (): Promise<void> => ipcRenderer.invoke('downloads:open-folder'),
  openItem: (id: string): Promise<void> => ipcRenderer.invoke('downloads:open-item', id),
  pauseDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:pause', id),
  resumeDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:resume', id),
  cancelDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:cancel', id),
  removeDownload: (id: string): Promise<void> => ipcRenderer.invoke('downloads:remove', id),
  getSettings: (): Promise<AppSettingsInfo> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettingsInfo>): Promise<AppSettingsInfo> =>
    ipcRenderer.invoke('settings:set', patch),
  guessLink: (url: string): Promise<LinkGuess | null> => ipcRenderer.invoke('links:guess', url),
  checkForUpdate: (): Promise<{ hasUpdate: boolean; latest: string; current: string; url?: string }> =>
    ipcRenderer.invoke('update:check'),
  onUpdateFound: (cb: (info: { hasUpdate: boolean; latest: string; current: string; url?: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload) => cb(payload)
    ipcRenderer.on('update:found', listener)
    return (): void => {
      ipcRenderer.removeListener('update:found', listener)
    }
  },
  onDownloadEvent: (cb: (evt: { type: string; item: DownloadItemInfo }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload) => cb(payload)
    ipcRenderer.on('download:event', listener)
    // unsubscribe pra limpar no unmount
    return (): void => {
      ipcRenderer.removeListener('download:event', listener)
    }
  },
  onCapturedLinks: (cb: (links: LinkGuess[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload) => cb(payload)
    ipcRenderer.on('links:captured', listener)
    return (): void => {
      ipcRenderer.removeListener('links:captured', listener)
    }
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (err) {
    console.error(err)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
