// popup: toggles gravados no chrome.storage; definições do app via servidor local
const SERVER = 'http://127.0.0.1:28123'

const SITE_LABELS = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['pinterest', 'Pinterest']
]

const TIPO_LABELS = [
  ['automatico', 'Baixar automático'],
  ['inteligente', 'Captura Inteligente'],
  ['video', 'Captura Vídeo'],
  ['musica', 'Captura música'],
  ['imagem', 'Captura imagem'],
  ['zip', 'Captura .zip'],
  ['exe', 'Captura .exe'],
  ['apk', 'Captura .apk'],
  ['rar', 'Captura .rar']
]

// espelham as definições do app (via /settings)
const APP_LABELS = [
  ['notifyDone', 'Avisar quando termina'],
  ['notifyFail', 'Avisar quando falha'],
  ['browserServer', 'Aceitar links da extensão']
]

const DEFAULTS = {
  sites: Object.fromEntries(SITE_LABELS.map(([k]) => [k, true])),
  tipos: Object.fromEntries(TIPO_LABELS.map(([k]) => [k, true]))
}

function buildToggle(container, group, key, label) {
  const row = document.createElement('label')
  row.className = 'row'
  row.innerHTML = `<span>${label}</span><span class="sw"><input type="checkbox" data-group="${group}" data-key="${key}"><span class="track"></span></span>`
  container.appendChild(row)
}

async function fetchSettings() {
  try {
    const res = await fetch(`${SERVER}/settings`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function saveAppSetting(key, value) {
  try {
    await fetch(`${SERVER}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value })
    })
  } catch {
    // app fechou enquanto mudava; o estado no próximo popup corre
  }
}

async function init() {
  const saved = (await chrome.storage.sync.get(['sites', 'tipos'])) ?? {}
  const sites = { ...DEFAULTS.sites, ...(saved.sites ?? {}) }
  const tipos = { ...DEFAULTS.tipos, ...(saved.tipos ?? {}) }

  const siteToggles = document.getElementById('siteToggles')
  const tipoToggles = document.getElementById('tipoToggles')
  const appToggles = document.getElementById('appToggles')

  SITE_LABELS.forEach(([k, label]) => buildToggle(siteToggles, 'sites', k, label))
  TIPO_LABELS.forEach(([k, label]) => buildToggle(tipoToggles, 'tipos', k, label))
  APP_LABELS.forEach(([k, label]) => buildToggle(appToggles, 'app', k, label))

  const inputs = Array.from(document.querySelectorAll('input[type=checkbox]'))
  for (const input of inputs) {
    const group = input.dataset.group
    const key = input.dataset.key
    if (group === 'app') {
      input.disabled = true
      continue // activo só quando o app responde
    }
    input.checked = Boolean(group === 'sites' ? sites[key] : tipos[key])
    input.addEventListener('change', async () => {
      const store = (await chrome.storage.sync.get([group])) ?? {}
      const patch = { ...(store[group] ?? {}), [key]: input.checked }
      await chrome.storage.sync.set({ [group]: patch })
    })
  }

  // estado do app + espelho das definições
  const state = document.getElementById('serverState')
  const hint = document.getElementById('appHint')
  const settings = await fetchSettings()
  if (settings && settings.ok) {
    state.textContent = `app ${settings.version ?? ''} ligado`
    state.classList.add('on')
    hint.hidden = true
    for (const input of inputs) {
      if (input.dataset.group !== 'app') continue
      input.checked = Boolean(settings[input.dataset.key])
      input.disabled = false
      input.addEventListener('change', () => saveAppSetting(input.dataset.key, input.checked))
    }
  } else {
    state.textContent = 'abre o WB-DM'
    state.classList.add('off')
    hint.hidden = false
  }
}

init()
