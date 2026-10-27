// contrato entre o DownloadManager e o MediaHandler, sem dependencia circular
import type { DownloadInfo } from './downloads'

export type MediaStatus = 'pending' | 'downloading' | 'paused'

export interface MediaHost {
  // cria um item novo na lista principal (emite evento 'added')
  registerItem(
    url: string,
    filename: string,
    category: string,
    note?: string
  ): DownloadInfo | null
  // atualiza progresso/estado (emite o evento correspondente)
  setStatus(
    id: string,
    status: MediaStatus,
    patch?: Partial<Pick<DownloadInfo, 'receivedBytes' | 'totalBytes' | 'speed'>>
  ): void
  // fecha o ciclo: status final + limpeza + proximo da fila
  finishItem(
    id: string,
    status: 'completed' | 'interrupted',
    extra?: { savePath?: string; error?: string }
  ): void
  // quantos downloads ainda cabem (maxConcurrent menos os a correr)
  spareSlots(): number
}
