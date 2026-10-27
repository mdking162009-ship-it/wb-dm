import { mkdirSync, openSync, closeSync, writeSync, existsSync, statSync, unlinkSync } from 'fs'
import { dirname } from 'path'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface Part {
  start: number
  end: number
  pos: number // offset atual de escrita
}

// baixa o arquivo em N conexões via Range, igual o IDM
export class SegmentedDownloader {
  private url: string
  readonly savePath: string
  private total: number
  private parts: Part[] = []
  private fd = -1
  private paused = false
  private cancelled = false
  private done = false
  private controllers: AbortController[] = []
  private received = 0
  private lastSpeedCheck = 0
  private lastSpeedReceived = 0
  private onUpdate: (speed: number, received: number) => void = () => {}
  private onDoneCallback: (err?: string) => void = () => {}
  private running = false
  speed = 0

  constructor(url: string, savePath: string, total: number, segments: number) {
    this.url = url
    this.savePath = savePath
    this.total = total
    // modelo: cada segmento no mínimo 1 MB, não vale a pena fragmentar arquivo pequeno
    const usable = Math.max(1, Math.min(segments, Math.floor(this.total / 1048576) || 1))
    const chunk = Math.ceil(this.total / usable)
    for (let i = 0; i < usable; i++) {
      const start = i * chunk
      const end = Math.min(this.total - 1, start + chunk - 1)
      if (start > end) break
      this.parts.push({ start, end, pos: start })
    }
  }

  // sondagem: o servidor aceita Range e qual o tamanho total?
  static async probe(url: string): Promise<{ ok: boolean; total: number }> {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' } })
      await res.arrayBuffer() // esvazia o corpo
      const cr = res.headers.get('content-range')
      if (res.status === 206 && cr) {
        const total = Number(cr.split('/')[1])
        if (Number.isFinite(total) && total > 0) return { ok: true, total }
      }
      const cl = res.headers.get('content-length')
      return { ok: false, total: cl ? Number(cl) : 0 }
    } catch {
      return { ok: false, total: 0 }
    }
  }

  async start(onUpdate: (s: number, r: number) => void, onDone: (err?: string) => void): Promise<void> {
    this.onUpdate = onUpdate
    this.onDoneCallback = onDone

    // restos de tentativa anterior com layout de partes diferente: começar do zero
    if (existsSync(this.savePath) && statSync(this.savePath).size !== this.total) {
      try {
        unlinkSync(this.savePath)
      } catch {
        // arquivo bloqueado, o openSync abaixo responde
      }
    }
    await this.run()
  }

  private async run(): Promise<void> {
    if (this.done || this.running) return
    this.running = true

    if (this.fd === -1) {
      mkdirSync(dirname(this.savePath), { recursive: true })
      this.fd = existsSync(this.savePath) ? openSync(this.savePath, 'r+') : openSync(this.savePath, 'w')
    }

    let failure: string | undefined
    const pending = this.parts.filter((p) => p.pos <= p.end)
    await Promise.all(pending.map((p) => this.runPart(p, (msg) => (failure ??= msg))))

    this.running = false
    if (failure) {
      this.closeFd()
      this.done = true
      this.onDoneCallback(failure)
    } else if (this.cancelled) {
      this.closeFd()
      this.done = true
      this.onDoneCallback('Cancelado pelo usuário')
    } else if (this.paused) {
      // aguarda retomada: estado fica na pos de cada segmento, fd aberto
    } else {
      this.closeFd()
      this.done = true
      this.onDoneCallback()
    }
  }

  private async runPart(part: Part, fail: (msg?: string) => void): Promise<void> {
    let retries = 0
    while (part.pos <= part.end && !this.cancelled && !this.paused) {
      const controller = new AbortController()
      this.controllers.push(controller)
      try {
        const res = await fetch(this.url, {
          headers: { 'User-Agent': UA, Range: `bytes=${part.pos}-${part.end}` },
          signal: controller.signal
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          this.writeAt(this.fd, buf, part.pos)
          this.received += buf.length
          part.pos += buf.length
          // o evento é limitado: 400 ms evita spam no renderizador
          const now = Date.now()
          if (now - this.lastSpeedCheck > 400) {
            this.updateSpeed()
            this.onUpdate(this.speed, this.received)
          }
        }
        retries = 0
      } catch (err) {
        if (this.cancelled || this.paused) return
        retries++
        if (retries > 3) {
          fail('Falha em uma das conexões')
          return
        }
        // vai para trás/retorna do pos
        await new Promise((r) => setTimeout(r, 1000 * retries))
      } finally {
        const i = this.controllers.indexOf(controller)
        if (i !== -1) this.controllers.splice(i, 1)
      }
    }
  }

  private writeAt(fd: number, buf: Buffer, pos: number): void {
    let written = 0
    while (written < buf.length) {
      written += writeSync(fd, buf, written, buf.length - written, pos + written)
    }
  }

  private updateSpeed(): void {
    const now = Date.now()
    if (this.lastSpeedCheck && now > this.lastSpeedCheck) {
      this.speed = Math.max(0, (this.received - this.lastSpeedReceived) / ((now - this.lastSpeedCheck) / 1000))
    }
    this.lastSpeedCheck = now
    this.lastSpeedReceived = this.received
  }

  private closeFd(): void {
    if (this.fd !== -1) {
      try {
        closeSync(this.fd)
      } catch {
        // não mexer
      }
      this.fd = -1
    }
  }

  pause(): void {
    if (this.done || this.paused) return
    this.paused = true
    for (const c of [...this.controllers]) c.abort()
    this.speed = 0
  }

  async resume(): Promise<void> {
    if (!this.paused || this.done) return
    this.paused = false
    this.lastSpeedCheck = 0
    this.lastSpeedReceived = 0
    // roda de novo: os segmentos retomam do último pos
    if (!this.running) await this.run()
  }

  cancel(): void {
    if (this.done) return
    this.cancelled = true
    for (const c of [...this.controllers]) c.abort()
    if (this.paused || !this.running) {
      this.closeFd()
      this.done = true
      this.onDoneCallback('Cancelado pelo usuário')
    }
  }

  isPaused(): boolean {
    return this.paused
  }
}
