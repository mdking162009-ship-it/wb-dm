// verificador de atualizacoes: consulta as releases do repositorio no github
// e avisa quando existir versao mais nova que a instalada
import { BrowserWindow, app, ipcMain } from 'electron'

// repositorio das releases: usado pelo verificador de atualizacoes
const GITHUB_REPO = 'mdking162009-ship-it/wb-dm'

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export interface UpdateInfo {
  hasUpdate: boolean
  latest: string
  current: string
  url?: string
}

function normalize(v: string): string {
  return v.trim().replace(/^v/i, '')
}

function compare(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export async function checkUpdate(): Promise<UpdateInfo> {
  const current = normalize(app.getVersion())
  const info: UpdateInfo = { hasUpdate: false, latest: current, current }
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'WB-DM' }
    })
    if (!res.ok) return info
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    if (!data.tag_name) return info
    const latest = normalize(data.tag_name)
    info.latest = latest
    info.url = data.html_url
    if (compare(latest, current) > 0) info.hasUpdate = true
  } catch {
    // sem internet ou repositorio ainda vazio: fica quieto
  }
  return info
}

function visibleWin(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
}

export function notifyUpdate(info: UpdateInfo): void {
  if (!info.hasUpdate) return
  const win = visibleWin()
  if (win) win.webContents.send('update:found', info)
}

export function startAutoUpdates(): void {
  const run = async (): Promise<void> => notifyUpdate(await checkUpdate())
  setTimeout(run, FIRST_CHECK_MS)
  setInterval(run, CHECK_EVERY_MS)
}

export function registerUpdateIpc(): void {
  ipcMain.handle('update:check', () => checkUpdate())
}
