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

function ext(url) {
  const p = url.split('?')[0].split('#')[0]
  return p.includes('.') ? p.split('.').pop().toLowerCase() : ''
}

function isVideoUrl(url) {
  const e = ext(url)
  return ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'ts', '3gp'].includes(e)
}

function isAudioUrl(url) {
  return ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'].includes(ext(url))
}

function isImageURL(url) {
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext(url))
}

function siteToggled(url, sites) {
  const host = (new URL(url).hostname || '').replace(/^www\./, '')
  if (host.endsWith('facebook.com') || host.endsWith('fb.watch')) return sites.facebook ? null : 'Facebook'
  if (host.endsWith('instagram.com')) return sites.instagram ? null : 'Instagram'
  if (host.endsWith('youtube.com') || host.endsWith('youtu.be')) return sites.youtube ? null : 'YouTube'
  if (host.includes('pinterest.com') || host === 'pin.it') return sites.pinterest ? null : 'Pinterest'
  if (host.endsWith('spotify.com')) return sites.spotify ? null : 'Spotify'
  return null
}

async function send(url) {
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

  try {
    // automatico off: o app mostra "Baixar?" em vez de adicionar logo
    const res = await fetch(`${SERVER}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url], auto: tipos.automatico })
    })
    if (!res.ok) throw new Error('App negou')
  } catch {
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icon128.png', title: 'WB-DM não está aberto',
      message: 'Abre o WB-DM no PC e tenta outra vez.'
    })
  }
}

function buildMenus() {
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
  // sem Captura Inteligente, so manda link/imagem/video diretos (nao a "pagina toda")
  const deliberate = Boolean(info.linkUrl || info.srcUrl)
  chrome.storage.sync.get(['tipos']).then((got) => {
    const tipos = { ...DEFAULTS.tipos, ...(got.tipos ?? {}) }
    if (!deliberate && !tipos.inteligente) return
    send(url)
  })
})

// achados do captura inteligente (content.js)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'wb-smart' || !Array.isArray(msg.urls)) return
  chrome.storage.sync.get(['tipos']).then((got) => {
    const tipos = { ...DEFAULTS.tipos, ...(got.tipos ?? {}) }
    if (!tipos.inteligente || !tipos.automatico) return
    let found = 0
    for (const url of msg.urls) {
      const used = captureByType(url, tipos)
      if (used) found++
    }
    if (found > 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'WB-DM — downloads encontrados',
        message: `${found} link(s) detetado(s) na página → WB-DM a baixar`
      })
    }
  })
})

// manda pro app se o tipo de captura estiver ligado; devolve true quando mandou
function captureByType(url, tipos) {
  const e = ext(url)
  let tipoOk = false
  if (isVideoUrl(url)) tipoOk = tipos.video
  else if (isAudioUrl(url)) tipoOk = tipos.musica
  else if (isImageURL(url)) tipoOk = tipos.imagem
  else if (TYPE_EXTS.zip.includes(e)) tipoOk = tipos.zip
  else if (TYPE_EXTS.exe.includes(e)) tipoOk = tipos.exe
  else if (TYPE_EXTS.apk.includes(e)) tipoOk = tipos.apk
  else if (TYPE_EXTS.rar.includes(e)) tipoOk = tipos.rar
  if (!tipoOk) return false
  fetch(`${SERVER}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: [url], auto: true })
  }).catch(() => {})
  return true
}
