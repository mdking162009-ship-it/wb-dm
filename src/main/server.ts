// micro servidor localhost: recebe links da extensao do navegador (estilo IDM)
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { BrowserWindow, app } from 'electron'
import type { DownloadManager } from './downloads'

const PORT = 28123

function cors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export function startCaptureServer(dm: DownloadManager): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    cors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())

    if (req.method === 'GET' && req.url?.startsWith('/ping')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, name: 'WB-DM', version: app.getVersion() }))
      return
    }

    // definições do app pro popup da extensão (só o que interessa la)
    const EXT_KEYS = ['notifyDone', 'notifyFail', 'browserServer'] as const

    if (req.method === 'GET' && req.url?.startsWith('/settings')) {
      const s = dm.getSettings()
      const out: Record<string, unknown> = { ok: true, version: app.getVersion() }
      for (const k of EXT_KEYS) out[k] = s[k]
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
      return
    }

    if (req.method === 'POST' && req.url?.startsWith('/settings')) {
      let body = ''
      req.on('data', (c) => (body = (body + c).slice(0, 10_000)))
      req.on('end', () => {
        try {
          const data = JSON.parse(body) as Record<string, unknown>
          const patch: Record<string, boolean> = {}
          for (const k of EXT_KEYS) {
            if (typeof data[k] === 'boolean') patch[k] = data[k] as boolean
          }
          if (Object.keys(patch).length === 0) throw new Error('nada para mudar')
          const s = dm.setSettings(patch)
          // integração desligada: /add passa a negar, o popup mostra logo o estado
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, notifyDone: s.notifyDone, notifyFail: s.notifyFail, browserServer: s.browserServer }))
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'definição inválida' }))
        }
      })
      return
    }

    if (req.method === 'POST' && req.url?.startsWith('/add')) {
      let body = ''
      req.on('data', (c) => (body = (body + c).slice(0, 100_000)))
      req.on('end', () => {
        let urls: string[] = []
        let auto = true
        try {
          const data = JSON.parse(body) as { urls?: unknown; url?: unknown; auto?: unknown }
          auto = data.auto !== false
          const raw = Array.isArray(data.urls) ? data.urls : [data.url]
          urls = raw.filter((u): u is string => typeof u === 'string')
            .join('\n')
            .split(/[\s,;\n]+/)
            .map((u) => u.trim())
            .filter(Boolean)
        } catch {
          // corpo invalido
        }
        // auto=false: a extensao quer que o app pergunte antes ("Baixar todos / Descartar")
        if (!dm.getSettings().browserServer) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'integração desligada nas Definições' }))
          return
        }
        if (auto) void dm.addUrls(urls)
        else dm.propose(urls)
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, queued: urls.length }))
        // traz a janela pra frente quando a extensão manda trabalho
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  server.on('error', () => {
    // porta ocupada (outra instância do wb-dm): a extensão continua a funcionar na outra
  })
  try {
    server.listen(PORT, '127.0.0.1')
  } catch {
    // sem servidor, o app continua sem a integração de navegador
  }
}
