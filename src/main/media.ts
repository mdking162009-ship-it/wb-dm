// downloads de midia (youtube, pinterest, instagram, facebook, tiktok, soundcloud)
// via yt-dlp: suporta videos paginas completas e playlists
import { spawn, ChildProcess } from 'child_process'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { pipeline } from 'stream'
import { join } from 'path'
import { app } from 'electron'
import type { MediaHost } from './host'

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

function hostOf(url: string): string {
  try {
    return (new URL(url).hostname ?? '').toLowerCase()
  } catch {
    return ''
  }
}

// dominios conhecidos de midia em pagina (nao ficheiro direto)
export function isMediaUrl(url: string): boolean {
  const h = hostOf(url)
  if (!h) return false
  const hosts = [
    'youtube.com', 'youtu.be', 'music.youtube.com',
    'instagram.com', 'facebook.com', 'fb.watch',
    'tiktok.com', 'vimeo.com',
    'x.com', 'twitter.com',
    'soundcloud.com', 'pinterest.com', 'pt.pinterest.com', 'pin.it'
  ]
  const pure = h.replace(/^www\./, '')
  return hosts.some((d) => pure === d || pure.endsWith('.' + d))
}

// o spotify protege as musicas com DRM, nao da pra baixar direto: avisamos
export function isSpotifyUrl(url: string): boolean {
  const h = hostOf(url).replace(/^www\./, '')
  return h === 'spotify.com' || h.endsWith('.spotify.com')
}

interface Task {
  id: string
  url: string
  dir: string
  child?: ChildProcess
  paused: boolean
  cancelled: boolean
  done: boolean
  finalPath?: string
  lastSpeedAt: number
  lastBytes: number
}

function bytesOf(value: number, unit: string): number {
  const mult = unit.startsWith('Ki') ? 1024 : unit.startsWith('Mi') ? 1024 ** 2 : unit.startsWith('Gi') ? 1024 ** 3 : 1
  return Math.round(value * mult)
}

function tail(lines: string[]): string {
  return lines.filter(Boolean).slice(-3).join(' | ').slice(0, 220)
}

export class MediaHandler {
  private host: MediaHost
  private bin: string | null
  private tasks = new Map<string, Task>()
  private pending: string[] = []
  private running = 0

  constructor(host: MediaHost) {
    this.host = host
    this.bin = null
  }

  handles(url: string): boolean {
    return isSpotifyUrl(url) || isMediaUrl(url)
  }

  // ---------------------------------------------------------------
  // localizar ou baixar o yt-dlp
  // ---------------------------------------------------------------

  private async localPath(): Promise<string> {
    const p = join(app.getPath('userData'), 'ytdlp', 'yt-dlp.exe')
    if (existsSync(p)) return p
    throw new Error('yt-dlp ainda não foi baixado')
  }

  private async ensureBin(): Promise<string> {
    if (this.bin) return this.bin
    // 1. binario baixado antes
    try {
      const p = await this.localPath()
      this.bin = p
      return p
    } catch {
      // segue
    }
    // 2. yt-dlp instalado no sistema (pip, scoop...)
    const found = await new Promise<string | null>((resolve) => {
      const where = spawn('where', ['yt-dlp'], { windowsHide: true })
      let out = ''
      where.stdout?.on('data', (c) => (out += c))
      where.on('close', (code) => {
        const first = out.split(/\r?\n/)[0]?.trim()
        resolve(code === 0 && first ? first : null)
      })
      where.on('error', () => resolve(null))
    })
    if (found) {
      this.bin = found
      return found
    }
    // 3. baixa da release oficial
    throw new Error('Não consegui obter o yt-dlp (verifica a internet e tenta de novo)')
  }

  async downloadBinOnce(): Promise<void> {
    const dir = join(app.getPath('userData'), 'ytdlp')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'yt-dlp.exe')
    const res = await fetch(YTDLP_URL)
    if (!res.ok || !res.body) throw new Error(`GitHub respondeu HTTP ${res.status}`)
    await pipeline(res.body as never, createWriteStream(target))
    this.bin = target
  }

  // chamado 1x por sessão em segundo plano pro primeiro download de midia não esperar
  preloadBin(): void {
    void this.ensureBin().catch(() => {
      // tentamos baixar direto; se falhar, o proximo download tenta de novo
      void this.downloadBinOnce().catch(() => {})
    })
  }

  // ---------------------------------------------------------------
  // fila de tarefas
  // ---------------------------------------------------------------

  async enqueue(url: string): Promise<void> {
    if (isSpotifyUrl(url)) {
      const item = this.host.registerItem(
        url,
        'música protegida (Spotify)',
        'audios',
        'Spotify protege as músicas com DRM — não é possível baixar direto. Procura a mesma música em vídeo/YT e copia esse link.'
      )
      if (item) this.host.finishItem(item.id, 'interrupted', { error: 'Spotify (DRM): não suportado direto' })
      return
    }

    let bin: string
    try {
      bin = await this.ensureBin()
    } catch (err) {
      // primeira vez: tenta baixar o yt-dlp agora
      try {
        await this.downloadBinOnce()
        bin = await this.ensureBin()
      } catch (err2) {
        const msg = err2 instanceof Error ? err2.message : 'falha desconhecida'
        const item = this.host.registerItem(url, 'media', 'videos', msg)
        if (item) this.host.finishItem(item.id, 'interrupted', { error: msg })
        return
      }
    }

    let meta
    try {
      meta = await this.probe(bin, url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'yt-dlp falhou a analisar o link'
      const item = this.host.registerItem(url, 'media', 'videos', msg)
      if (item) this.host.finishItem(item.id, 'interrupted', { error: msg })
      return
    }

    const tracks =
      meta.entries && meta.entries.length > 0
        ? meta.entries.slice(0, 300)
        : [
            {
              url,
              title: meta.title || 'video'
            }
          ]

    for (const t of tracks) {
      const item = this.host.registerItem(t.url, t.title ?? 'video', meta.category)
      if (!item) continue
      const task: Task = {
        id: item.id,
        url: t.url,
        dir: item.dir,
        paused: false,
        cancelled: false,
        done: false,
        lastSpeedAt: 0,
        lastBytes: 0
      }
      this.tasks.set(item.id, task)
      this.pending.push(item.id)
    }
    this.pump()
  }

  private probe(bin: string, url: string): Promise<{
    title?: string
    category: string
    entries: Array<{ url: string; title?: string }>
  }> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, ['-J', '--flat-playlist', '--no-warnings', url], { windowsHide: true })
      let out = ''
      let er = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('yt-dlp demorou demais a responder ao link'))
      }, 30_000)
      child.stdout?.on('data', (c) => (out += c))
      child.stderr?.on('data', (c) => (er += c))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`yt-dlp não pôde ser executado: ${e.message}`))
      })
      child.on('close', () => {
        clearTimeout(timer)
        try {
          const data = JSON.parse(out) as {
            _type?: string
            title?: string
            extractor_key?: string
            entries?: Array<{ url?: string; id?: string; title?: string }>
          }
          const isPlaylist = data._type === 'playlist' && (data.entries?.length ?? 0) > 0
          const ek = (data.extractor_key ?? '').toLowerCase()
          const category = ek.includes('instagram') && !isPlaylist ? 'imagens' : ek.includes('soundcloud') || ek.includes('music') ? 'audios' : 'videos'
          const entries: Array<{ url: string; title?: string }> = isPlaylist
            ? (data.entries ?? [])
                .map((e) => {
                  const u = e.url
                    ? e.url.startsWith('http')
                      ? e.url
                      : `https://www.youtube.com/watch?v=${e.url}`
                    : e.id
                      ? `https://www.youtube.com/watch?v=${e.id}`
                      : null
                  if (!u) return null
                  return { url: u, title: e.title }
                })
                .filter((v) => v !== null)
            : []
          resolve({ title: data.title, category, entries })
        } catch {
          reject(new Error(`yt-dlp falhou a analisar o link: ${tail(er.split(/\r?\n/)) || 'sem detalhes'}`))
        }
      })
    })
  }

  private pump(): void {
    const slots = Math.max(0, this.host.spareSlots())
    while (this.running < slots && this.pending.length > 0) {
      const id = this.pending.shift()
      if (!id) break
      const task = this.tasks.get(id)
      if (!task || task.done || task.cancelled) continue
      this.startTask(task)
    }
  }

  private startTask(task: Task): void {
    this.running++
    this.host.setStatus(task.id, 'downloading')
    task.paused = false
    task.lastSpeedAt = 0
    task.lastBytes = 0

    const args = [
      '--newline', '--no-warnings', '--no-playlist',
      '--concurrent-fragments', '4',
      '-o', join(task.dir, '%(title).170B.%(ext)s'),
      task.url
    ]
    const child = spawn(this.bin ?? '', args, { windowsHide: true, cwd: task.dir })
    task.child = child

    child.on('error', (e) => {
      if (task.done || task.cancelled || task.paused) return
      this.running--
      task.done = true
      this.host.finishItem(task.id, 'interrupted', { error: `yt-dlp não pôde iniciar: ${e.message}` })
      this.pump()
    })

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      for (const line of text.split(/\r?\n/)) {
        if (line.includes('Destination:')) {
          task.finalPath = line.split('Destination:')[1]?.trim()
        }
        const m = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(Ki|Mi|Gi)B/.exec(line)
        if (m) {
          const total = bytesOf(Number(m[2]), m[3])
          const received = Math.round((Number(m[1]) / 100) * total)
          const now = Date.now()
          const speed =
            task.lastSpeedAt && now > task.lastSpeedAt
              ? Math.max(0, (received - task.lastBytes) / ((now - task.lastSpeedAt) / 1000))
              : 0
          task.lastSpeedAt = now
          task.lastBytes = received
          this.host.setStatus(task.id, 'downloading', {
            receivedBytes: received,
            totalBytes: total,
            speed
          })
        }
      }
    })

    let stderr = ''
    child.stderr?.on('data', (c) => (stderr = (stderr + String(c)).slice(-2000)))

    child.on('close', (code) => {
      if (task.done) return
      this.running--
      if (task.cancelled) {
        task.done = true
        this.host.finishItem(task.id, 'interrupted', { error: 'Cancelado pelo utilizador' })
        return
      }
      if (task.paused) {
        // yt-dlp guarda o .part: ao retomar, continua do ponto
        return
      }
      task.done = true
      if (code === 0) {
        this.host.finishItem(task.id, 'completed', { savePath: task.finalPath })
      } else {
        const lines = stderr.split(/\r?\n/).filter((l) => l.includes('ERROR') || l.trim().length > 0)
        this.host.finishItem(task.id, 'interrupted', { error: `yt-dlp: ${tail(lines) || `código ${code}`}` })
      }
      this.pump()
    })
  }

  owns(id: string): boolean {
    const task = this.tasks.get(id)
    return !!task && !task.done
  }

  pause(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.done || task.cancelled || task.paused) return false
    task.paused = true
    task.child?.kill()
    this.host.setStatus(id, 'paused')
    return true
  }

  resume(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.done || task.cancelled || !task.paused) return false
    if (this.host.spareSlots() <= 0) {
      this.pending.push(id)
      this.host.setStatus(id, 'pending')
      return true
    }
    this.startTask(task)
    return true
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false
    task.cancelled = true
    const pendingIdx = this.pending.indexOf(id)
    if (pendingIdx !== -1) this.pending.splice(pendingIdx, 1)
    if (task.done) return false
    task.done = true
    task.child?.kill()
    if (task.child && this.running > 0) this.running--
    this.host.finishItem(id, 'interrupted', { error: 'Cancelado pelo utilizador' })
    this.pump()
    return true
  }
}
