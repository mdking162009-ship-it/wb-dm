import { app, BrowserWindow, DownloadItem, dialog, ipcMain, session, shell, clipboard } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { SegmentedDownloader } from './segmented'
import { MediaHandler, isSpotifyUrl, isMediaUrl } from './media'
import type { MediaHost, MediaStatus } from './host'

type Status = 'pending' | 'downloading' | 'paused' | 'completed' | 'interrupted'

export interface AppSettings {
  subfolders: boolean
  askSave: boolean
  maxConcurrent: number
  segments: number
  captureClipboard: boolean
  captureAutoDownload: boolean
  checkUpdates: boolean
}

const DEFAULTS: AppSettings = {
  subfolders: true,
  askSave: false,
  maxConcurrent: 3,
  segments: 8,
  captureClipboard: false,
  captureAutoDownload: false,
  checkUpdates: true
}

export interface DownloadInfo {
  id: string
  url: string
  filename: string
  category: string
  dir: string
  savePath: string
  status: Status
  receivedBytes: number
  totalBytes: number
  speed: number
  startedAt: number
  finishedAt?: number
  error?: string
}

const EXT: Record<string, string[]> = {
  imagens: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico', 'heic'],
  videos: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'mpg', 'mpeg', 'wmv', 'ts', '3gp'],
  audios: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus'],
  documentos: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf', 'epub', 'odt'],
  arquivos: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'apk'],
  programas: ['exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'appimage']
}

const FOLDERS: Record<string, string> = {
  imagens: 'Imagens',
  videos: 'Videos',
  audios: 'Audios',
  documentos: 'Documentos',
  arquivos: 'Arquivos',
  programas: 'Programas',
  outros: 'Outros'
}

function extOf(url: string): string {
  try {
    const path = decodeURIComponent(new URL(url).pathname)
    return path.includes('.') ? (path.split('.').pop()?.toLowerCase() ?? '') : ''
  } catch {
    return ''
  }
}

function catOf(url: string): string {
  const ext = extOf(url)
  if (!ext) return 'outros'
  for (const [cat, exts] of Object.entries(EXT)) {
    if (exts.includes(ext)) return cat
  }
  return 'outros'
}

function safeName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/_{2,}/g, '_').replace(/^[\s._]+|[\s._]+$/g, '')
  return cleaned.slice(0, 180) || `download-${Date.now()}`
}

function nameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
    if (last && last.includes('.')) return safeName(last)
    return `download-${Date.now()}`
  } catch {
    return `download-${Date.now()}`
  }
}

// igual o navegador: se o arquivo já existe vem (1), (2)...
function dedupePath(dir: string, name: string): string {
  let candidate = join(dir, name)
  if (!existsSync(candidate)) return candidate
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i < 1000; i++) {
    candidate = join(dir, `${base} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return join(dir, `${base}-${Date.now()}${ext}`)
}

export function guessInfo(url: string): { filename: string; ext: string; category: string } | null {
  try {
    new URL(url)
  } catch {
    return null
  }
  return { filename: nameFromUrl(url), ext: extOf(url), category: catOf(url) }
}

export class DownloadManager {
  private win: BrowserWindow | undefined
  private folder: string
  private settings: AppSettings
  private items = new Map<string, DownloadInfo>()
  private byUrl = new Map<string, DownloadInfo>()
  private live = new Map<string, DownloadItem>()
  private segs = new Map<string, SegmentedDownloader>()
  private running = new Set<string>()
  private queue: string[] = []
  private samples = new Map<string, { t: number; bytes: number }>()
  private captureTimer: NodeJS.Timeout | undefined
  private lastClipboard = ''
  private media: MediaHandler

  constructor() {
    this.folder = this.loadFolder()
    this.settings = this.loadSettings()
    // referencia ao DownloadItem é necessária pro pause/resume
    session.defaultSession.on('will-download', (_e, item) => this.onWillDownload(item))
    // se o capturador ficou ligado na sessão anterior, reativa o timer
    this.syncCapture()
    // motor de mídia (yt-dlp) com acesso à lista principal
    const host: MediaHost = {
      registerItem: (url, filename, category, note) => this.registerItem(url, filename, category, note),
      setStatus: (id, status, patch) => this.setMediaStatus(id, status, patch),
      finishItem: (id, status, extra) => this.finishMediaItem(id, status, extra),
      spareSlots: () => this.settings.maxConcurrent - this.running.size
    }
    this.media = new MediaHandler(host)
    // baixa o yt-dlp em segundo plano pra primeira mídia não esperar
    this.media.preloadBin()
  }

  mediaHandles(url: string): boolean {
    return this.media.handles(url)
  }

  mediaCategory(url: string): string {
    if (isSpotifyUrl(url)) return 'audios'
    if (/pinterest|pin\.it/i.test(url) && /\.jpg|jpeg|png|webp/i.test(url)) return 'imagens'
    return isMediaUrl(url) ? 'videos' : 'outros'
  }

  attachWindow(win: BrowserWindow): void {
    this.win = win
  }

  getFolder(): string {
    return this.folder
  }

  getItems(): DownloadInfo[] {
    return [...this.items.values()]
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const before = this.settings.captureClipboard
    this.settings = { ...this.settings, ...patch }
    this.saveSettings()
    if (this.settings.maxConcurrent < 1) this.settings.maxConcurrent = 1
    if (this.settings.maxConcurrent > 8) this.settings.maxConcurrent = 8
    if (this.settings.segments < 1) this.settings.segments = 1
    if (this.settings.segments > 16) this.settings.segments = 16
    if (this.settings.captureClipboard !== before) this.syncCapture()
    this.startQueue()
    return this.getSettings()
  }

  async chooseFolder(): Promise<string | null> {
    if (!this.win) return null
    const result = await dialog.showOpenDialog(this.win, {
      title: 'Onde salvar os downloads?',
      defaultPath: this.folder,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    this.folder = result.filePaths[0]
    this.saveFolder()
    return this.folder
  }

  clearFinished(): void {
    for (const [id, item] of this.items) {
      if (item.status === 'completed' || item.status === 'interrupted') this.items.delete(id)
    }
  }

  openFolder(): void {
    if (existsSync(this.folder)) shell.openPath(this.folder)
  }

  openItem(id: string): void {
    const item = this.items.get(id)
    if (!item || item.status !== 'completed') return
    shell.openPath(item.savePath).then((err) => {
      if (err) shell.showItemInFolder(item.savePath)
    })
  }

  // -------------------------------------------------------------------
  // itens vindos do motor de mídia
  // -------------------------------------------------------------------

  private registerItem(
    url: string,
    filename: string,
    category: string,
    note?: string
  ): DownloadInfo | null {
    const known = this.byUrl.get(url)
    if (known && !['completed', 'interrupted'].includes(known.status)) return null
    const dir = this.settings.subfolders
      ? join(this.folder, FOLDERS[category] ?? FOLDERS.outros)
      : this.folder
    const item: DownloadInfo = {
      id: randomUUID(),
      url,
      filename: safeName(filename),
      category,
      dir,
      savePath: '',
      status: note ? 'interrupted' : 'pending',
      receivedBytes: 0,
      totalBytes: 0,
      speed: 0,
      startedAt: Date.now(),
      error: note
    }
    this.items.set(item.id, item)
    this.byUrl.set(url, item)
    this.emit('added', item)
    if (note) this.finish(item)
    return item
  }

  private setMediaStatus(
    id: string,
    status: MediaStatus,
    patch?: Partial<Pick<DownloadInfo, 'receivedBytes' | 'totalBytes' | 'speed'>>
  ): void {
    const rec = this.items.get(id)
    if (!rec) return
    if (patch) {
      if (patch.receivedBytes !== undefined) rec.receivedBytes = patch.receivedBytes
      if (patch.totalBytes !== undefined) rec.totalBytes = patch.totalBytes
      if (patch.speed !== undefined) rec.speed = patch.speed
    }
    rec.status = status
    this.emit(status, rec)
  }

  private finishMediaItem(
    id: string,
    status: 'completed' | 'interrupted',
    extra?: { savePath?: string; error?: string }
  ): void {
    const rec = this.items.get(id)
    if (!rec) return
    rec.status = status
    if (extra?.savePath) rec.savePath = extra.savePath
    if (extra?.error) rec.error = extra.error
    rec.speed = 0
    rec.finishedAt = Date.now()
    if (status === 'completed') rec.receivedBytes = rec.totalBytes || rec.receivedBytes
    this.finish(rec)
  }

  pause(id: string): boolean {
    const rec = this.items.get(id)
    if (!rec) return false
    // mídia tem caminho próprio (yt-dlp), depois o segmentado, depois os herdados do electron
    if (this.media.owns(id)) {
      if (this.media.pause(id)) {
        rec.status = 'paused'
        this.emit('paused', rec)
        return true
      }
      return false
    }
    const seg = this.segs.get(id)
    if (seg) {
      seg.pause()
      rec.status = 'paused'
      this.emit('paused', rec)
      return true
    }
    const live = this.live.get(id)
    if (!live) return false
    live.pause()
    rec.status = 'paused'
    this.emit('paused', rec)
    return true
  }

  resume(id: string): boolean {
    const rec = this.items.get(id)
    if (!rec) return false
    if (this.media.owns(id)) {
      if (this.media.resume(id)) {
        rec.status = 'downloading'
        this.emit('downloading', rec)
        return true
      }
      return false
    }
    const seg = this.segs.get(id)
    if (seg) {
      seg.resume()
      rec.status = 'downloading'
      this.emit('downloading', rec)
      return true
    }
    const live = this.live.get(id)
    if (!live) return false
    live.resume()
    rec.status = 'downloading'
    this.emit('downloading', rec)
    return true
  }

  cancel(id: string): boolean {
    // primeiro o motor de mídia; ele marca o item como interrompido sozinho
    if (this.media.owns(id)) {
      this.media.cancel(id)
      return true
    }
    const seg = this.segs.get(id)
    if (seg) {
      seg.cancel()
      return true
    }
    const live = this.live.get(id)
    if (!live) {
      // ainda só na fila: mata direto
      const rec = this.items.get(id)
      if (rec && rec.status === 'pending') {
        rec.status = 'interrupted'
        rec.error = 'Cancelado da fila'
        this.queue = this.queue.filter((q) => q !== id)
        this.finish(rec)
        return true
      }
      return false
    }
    live.cancel()
    return true
  }

  remove(id: string): boolean {
    const rec = this.items.get(id)
    if (!rec || ['downloading', 'paused', 'pending'].includes(rec.status)) return false
    this.live.delete(id)
    this.samples.delete(id)
    this.items.delete(id)
    this.byUrl.delete(rec.url)
    return true
  }

  async addUrls(raw: string[]): Promise<{ added: DownloadInfo[]; invalid: string[] }> {
    const added: DownloadInfo[] = []
    const invalid: string[] = []

    for (const entry of raw) {
      const url = entry.trim()
      let ok = false
      try {
        ok = ['http:', 'https:'].includes(new URL(url).protocol)
      } catch {
        ok = false
      }
      if (!url || !ok) {
        if (url) invalid.push(url)
        continue
      }

      const running = this.byUrl.get(url)
      if (running && ['pending', 'downloading', 'paused'].includes(running.status)) {
        invalid.push(url)
        continue
      }

      // mídia (youtube/pinterest/instagram/facebook...): vai pro motor do yt-dlp
      if (this.media.handles(url)) {
        void this.media.enqueue(url).catch(() => {})
        continue
      }

      const category = catOf(url)
      const dir = this.settings.subfolders
        ? join(this.folder, FOLDERS[category] ?? FOLDERS.outros)
        : this.folder

      const item: DownloadInfo = {
        id: randomUUID(),
        url,
        filename: nameFromUrl(url),
        category,
        dir,
        savePath: '',
        status: 'pending',
        receivedBytes: 0,
        totalBytes: 0,
        speed: 0,
        startedAt: Date.now()
      }

      this.items.set(item.id, item)
      this.byUrl.set(url, item)
      added.push(item)
      this.emit('added', item)
      this.queue.push(item.id)
    }

    this.startQueue()
    return { added, invalid }
  }

  // respeita o maxConcurrent, o resto fica na fila
  private startQueue(): void {
    while (this.running.size < this.settings.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift()
      const item = id ? this.items.get(id) : undefined
      if (!item || item.status !== 'pending') continue
      this.download(item)
    }
  }

  private async download(info: DownloadInfo): Promise<void> {
    // segmentado só vale sem askSave (dialogo é coisa do caminho herdado)
    if (this.settings.segments > 1 && !this.settings.askSave) {
      const probe = await SegmentedDownloader.probe(info.url)
      if (probe.ok && probe.total > 0) {
        const dir = this.settings.subfolders ? info.dir : this.folder
        mkdirSync(dir, { recursive: true })
        const savePath = this.dedupePath(dir, info.filename)
        info.savePath = savePath
        info.status = 'downloading'
        this.running.add(info.id)
        this.emit('downloading', info)

        const seg = new SegmentedDownloader(info.url, savePath, probe.total, this.settings.segments)
        this.segs.set(info.id, seg)

        void seg
          .start(
            (speed, received) => {
              info.speed = speed
              info.receivedBytes = received
              info.totalBytes = probe.total
              this.emit('downloading', info)
            },
            (err) => {
              this.segs.delete(info.id)
              this.running.delete(info.id)
              info.totalBytes = probe.total
              info.speed = 0
              info.finishedAt = Date.now()
              if (err) {
                info.status = 'interrupted'
                info.error = err
              } else {
                info.status = 'completed'
                info.receivedBytes = probe.total
              }
              this.finish(info)
            }
          )
          .catch((err) => {
            this.segs.delete(info.id)
            this.running.delete(info.id)
            info.status = 'interrupted'
            info.error = err instanceof Error ? err.message : 'Falha no download'
            this.finish(info)
          })
        return
      }
      // sem suporte a Range cai pra conexão única
    }

    if (this.settings.subfolders) mkdirSync(info.dir, { recursive: true })
    // janela escondida só pra disparar o download
    const win = new BrowserWindow({
      show: false,
      width: 0,
      height: 0,
      webPreferences: { backgroundThrottling: false }
    })
    win.webContents.downloadURL(info.url)
    win.on('closed', () => {
      if (info.status === 'downloading') {
        info.status = 'interrupted'
        info.error = 'Download cancelado'
        this.finish(info)
      } else if (info.status === 'pending') {
        // janela morreu antes de começar, volta pra fila
        info.status = 'pending'
        this.queue.unshift(info.id)
      }
    })
  }

  // igual o navegador: se o arquivo já existe vem (1), (2)...
  private dedupePath(dir: string, name: string): string {
    let candidate = join(dir, name)
    if (!existsSync(candidate)) return candidate
    const dot = name.lastIndexOf('.')
    const base = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let i = 1; i < 1000; i++) {
      candidate = join(dir, `${base} (${i})${ext}`)
      if (!existsSync(candidate)) return candidate
    }
    return join(dir, `${base}-${Date.now()}${ext}`)
  }

  private onWillDownload(item: DownloadItem): void {
    const url = item.getURL()
    // se tiver redirect o item muda de URL, tenta a original também
    const info = this.byUrl.get(url) ?? this.byUrl.get(item.getURLChain()[0] ?? url)
    if (!info) return

    info.status = 'downloading'
    this.running.add(info.id)

    info.filename = safeName(item.getFilename())

    if (this.settings.askSave) {
      // deixa o usuário escolher o destino na hora
      item.setSaveDialogOptions({
        title: 'Salvar como...',
        defaultPath: join(info.dir, info.filename)
      })
    } else {
      const dir = this.settings.subfolders ? info.dir : this.folder
      mkdirSync(dir, { recursive: true })
      const savePath = dedupePath(dir, info.filename)
      item.setSavePath(savePath)
      info.savePath = savePath
    }

    this.live.set(info.id, item)
    this.emit('downloading', info)

    item.on('updated', (_e, state) => {
      // média de velocidade entre os updates que o electron manda
      const now = Date.now()
      const last = this.samples.get(info.id)
      if (last && now > last.t) {
        info.speed = Math.max(0, (item.getReceivedBytes() - last.bytes) / ((now - last.t) / 1000))
      }
      this.samples.set(info.id, { t: now, bytes: item.getReceivedBytes() })
      info.receivedBytes = item.getReceivedBytes()
      info.totalBytes = item.getTotalBytes()
      info.status = state === 'interrupted' ? 'interrupted' : 'downloading'
      this.emit('downloading', info)
    })

    item.once('done', (_e, state) => {
      this.live.delete(info.id)
      this.running.delete(info.id)
      this.samples.delete(info.id)
      const finalPath = item.getSavePath()
      if (finalPath) info.savePath = finalPath
      info.receivedBytes = item.getReceivedBytes()
      info.totalBytes = item.getTotalBytes()
      info.speed = 0
      info.finishedAt = Date.now()
      if (state === 'completed') {
        info.status = 'completed'
      } else {
        info.status = 'interrupted'
        info.error = state === 'cancelled' ? 'Cancelado pelo usuário' : 'Falha no download'
      }
      this.finish(info)
    })
  }

  private finish(info: DownloadInfo): void {
    this.emit(info.status === 'completed' ? 'completed' : 'interrupted', info)
    this.byUrl.delete(info.url)
    this.startQueue()
  }

  private emit(
    type: 'added' | 'downloading' | 'paused' | 'pending' | 'completed' | 'interrupted',
    rec: DownloadInfo
  ): void {
    // a janela principal é a única visível, as de download ficam escondidas
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('download:event', { type, item: rec })
    }
  }

  // -------------------------------------------------------------------
  // capturador de links (clipboard)
  // -------------------------------------------------------------------

  private syncCapture(): void {
    if (this.settings.captureClipboard && !this.captureTimer) {
      clipboard.readText().then((t) => (this.lastClipboard = t))
      this.captureTimer = setInterval(() => {
        this.pollClipboard().catch(() => {})
      }, 1200)
    } else if (!this.settings.captureClipboard && this.captureTimer) {
      clearInterval(this.captureTimer)
      this.captureTimer = undefined
    }
  }

  private async pollClipboard(): Promise<void> {
    const text = await clipboard.readText()
    if (!text || text === this.lastClipboard) return
    this.lastClipboard = text

    const urls = text
      .split(/[\s,;\n]+/)
      .map((u) => u.trim())
      .filter((u) => {
        try {
          return ['http:', 'https:'].includes(new URL(u).protocol)
        } catch {
          return false
        }
      })
      .filter((u) => {
        const known = this.byUrl.get(u)
        return !known || !['pending', 'downloading', 'paused'].includes(known.status)
      })

    if (urls.length === 0) return

    const guesses = urls
      .map((u) => {
        const g = guessInfo(u)
        return g ? { url: u, ...g } : null
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)

    if (guesses.length === 0) return

    if (this.settings.captureAutoDownload) {
      await this.addUrls(urls)
      return
    }
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('links:captured', guesses)
    }
  }

  // -------------------------------------------------------------------
  // persistencia
  // -------------------------------------------------------------------

  private cfgPath(): string {
    return join(app.getPath('userData'), 'config.json')
  }

  private readCfg<T>(key: string): T | undefined {
    try {
      return (JSON.parse(readFileSync(this.cfgPath(), 'utf-8')) as Record<string, unknown>)[key] as T
    } catch {
      return undefined
    }
  }

  private loadFolder(): string {
    const folder = this.readCfg<string>('folder')
    if (folder) return folder
    return join(app.getPath('downloads'), 'Gerenciador de Downloads')
  }

  private loadSettings(): AppSettings {
    const saved = this.readCfg<Partial<AppSettings>>('settings')
    return { ...DEFAULTS, ...(saved ?? {}) }
  }

  private writeCfg(values: Record<string, unknown>): void {
    try {
      const current = (() => {
        try {
          return JSON.parse(readFileSync(this.cfgPath(), 'utf-8'))
        } catch {
          return {}
        }
      })()
      writeFileSync(this.cfgPath(), JSON.stringify({ ...current, ...values }, null, 2))
    } catch {
      // escrita falhou, segue o jogo
    }
  }

  private saveSettings(): void {
    this.writeCfg({ settings: this.settings })
  }

  private saveFolder(): void {
    this.writeCfg({ folder: this.folder })
  }
}

export function registerDownloadIpc(dm: DownloadManager): void {
  ipcMain.handle('downloads:add', (_e, urls: string) => {
    const list = (urls ?? '')
      .split(/[\s,;\n]+/)
      .map((u) => u.trim())
      .filter(Boolean)
    return dm.addUrls(list)
  })

  ipcMain.handle('downloads:get-folder', () => dm.getFolder())
  ipcMain.handle('downloads:get-items', () => dm.getItems())
  ipcMain.handle('downloads:choose-folder', () => dm.chooseFolder())
  ipcMain.handle('downloads:clear-finished', () => dm.clearFinished())
  ipcMain.handle('downloads:open-folder', () => dm.openFolder())
  ipcMain.handle('downloads:open-item', (_e, id: string) => dm.openItem(id))
  ipcMain.handle('downloads:pause', (_e, id: string) => dm.pause(id))
  ipcMain.handle('downloads:resume', (_e, id: string) => dm.resume(id))
  ipcMain.handle('downloads:cancel', (_e, id: string) => dm.cancel(id))
  ipcMain.handle('downloads:remove', (_e, id: string) => dm.remove(id))
  ipcMain.handle('settings:get', () => dm.getSettings())
  ipcMain.handle('settings:set', (_e, patch) => dm.setSettings(patch))
  ipcMain.handle('links:guess', (_e, url: string) => {
    // links de mídia não têm extensão no path; app já sabe o motor que vai usar
    if (dm.mediaHandles(url)) {
      return {
        filename: isSpotifyUrl(url) ? 'música Spotify (DRM)' : 'mídia (vídeo/áudio)',
        ext: 'mp4',
        category: dm.mediaCategory(url)
      }
    }
    return guessInfo(url)
  })
}
