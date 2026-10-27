import type { Api, DownloadItemInfo } from './index'

declare global {
  interface Window {
    api: Api
    electron?: unknown
  }
}

export type { DownloadItemInfo }
export {}
