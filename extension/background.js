// WB-DM ext: manda links pro app via servidor local (127.0.0.1:28123)
const SERVER = 'http://127.0.0.1:28123'

const DEFAULTS = {
  sites: { facebook: true, instagram: true, youtube: true, pinterest: true, spotify: true },
  tipos: { automatico: true, inteligente: true, video: true, musica: true, imagem: true, zip: true, exe: true, apk: true, rar: true }
}

const TYPE_EXTS = {
  zip: ['zip', 'tar', 'gz', '7z', 'bz2', 'xz'],
  exe: ['exe', 'msi'],
  apk: ['apk'],
  rar: ['rar']
}

function ext(url = ''): string {
  const p = url.split('?')[0].split('#')[0]
  return p.includes('.') ? p.split('.').pop().toLowerCase() : ''
}

function isVideoUrl(url: string): boolean {
  const e = ext(url)
  return ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'ts', '3gp'].includes(e)
}

function isAudioUrl(url: string): boolean {
  return ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'].includes(ext(url))
}

function isImageURL(url: string): boolean {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext(url))
}

function siteToggled(url, sites): string | null {
  const host = (new URL(url).hostname || '').replace(/^www\./, '')
  if (host.endsWith('facebook.com') || host.endsWith('fb.watch')) return sites.facebook ? null : 'Facebook'
  if (host.endsWith('instagram.com')) return sites.instagram ? null : 'Instagram'
  if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('youtu.be')) return sites.youtube ? null : 'YouTube'
  if (host.includes('pinterest.com') || host === 'pin.it') return sites.pinterest ? null : 'Pinterest'
  if (host.endsWith('spotify.com')) return sites.spotify ? null : 'Spotify'
  return null
}

async function send(url: string): Promise<void> {
  const cfg = { ...DEFAULTS, ...((await chrome.storage.sync.get(['sites', 'tipos'])) ?? {}) }
  const sites = cfg.sites || DEFAULTS.sites
  const tipos = cfg.tipos || DEFAULTS.tipos

  const blockedSite = siteToggled(url, sites)
  if (blockedSite) {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icon128.png', title: 'WB-DM',
      message: `Captura de ${blockedSite} está desligada (clica no ícone da extensão)`
    })
    return
  }

  if (!dontCheck) {
    const e = ext(url)
    let tipoOk = true
    if (isVideoUrl(url)) tipoOk = tipos.video
    else if (isAudioUrl(url)) tipoOk = tipos.musica
    else if (isImageURL(url)) tipoOk = tipos.imagem
    else if (TYPE_EXTS.zip.includes(e)) tipoOk = tipos.zip
    else if (TYPE_EXTS.exe.includes(e)) tipoOk = tipos.exe
    else if (TYPE_EXTS.apk.includes(e)) tipoOk = tipos.apk
    else if (TYPE_EXTS.rar.includes(e)) tipoOk = tipos.rar
    if (!tipoOk) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icon128.png', title: 'WB-DM',
        message: `Captura do tipo .${e} está desligada (clica no ícone da extensão)`
      })
      return
    }
  }

  try {
    const res = await fetch(`${SERVER}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url] })
    })
    if (!res.ok) throw new Error('App negou')
  } catch {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icon128.png', title: 'WB-DM não está aberto',
      message: 'Abre o WB-DM no PC (e confirma que o Servidor de captura está ativo) e tenta outra vez.'
    })
  }
}

function buildMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'wb-link', title: 'Baixar com WB-DM', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'wb-video', title: 'Baixar vídeo (WB-DM)', contexts: ['video', 'audio', 'page'] })
    chrome.contextMenus.create({ id: 'wb-image', title: 'Baixar imagem (WB-DM)', contexts: ['image'] })
  })
}

chrome.runtime.onInstalled.addListener(buildMenus)
chrome.runtime.onStartup.addListener(buildMenus)

chrome.contextMenus.onClicked.addListener((info) => {
  const url = info.linkUrl || info.srcUrl || info.pageUrl
  if (!url) return
  send(url)
})
