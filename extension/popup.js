// popup: toggles gravados no chrome.storage; status do servidor local
const SITE_LABELS = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['pinterest', 'Pinterest'],
  ['spotify', 'Spotify']
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

async function init() {
  const saved = (await chrome.storage.sync.get(['sites', 'tipos'])) ?? {}
  const sites = { ...DEFAULTS.sites, ...(saved.sites ?? {}) }
  const tipos = { ...DEFAULTS.tipos, ...(saved.tipos ?? {}) }

  const siteToggles = document.getElementById('siteToggles')
  const tipoToggles = document.getElementById('tipoToggles')

  SITE_LABELS.forEach(([k, label]) => buildToggle(siteToggles, 'sites', k, label))
  TIPO_LABELS.forEach(([k, label]) => buildToggle(tipoToggles, 'tipos', k, label))

  const inputs = document.querySelectorAll('input[type=checkbox]')
  for (const input of Array.from(inputs)) {
    const group = input.dataset.group
    const key = input.dataset.key
    input.checked = Boolean(group === 'sites' ? sites[key] : tipos[key])
    input.addEventListener('change', async () => {
      const store = (await chrome.storage.sync.get([group])) ?? {}
      const patch = { ...(store[group] ?? {}), [key]: input.checked }
      await chrome.storage.sync.set({ [group]: patch })
    })
  }

  // app aberto? pergunta ao servidor local
  const state = document.getElementById('serverState')
  try {
    const res = await fetch('http://127.0.0.1:28123/ping')
    const data = await res.json()
    if (res.ok && data.ok) {
      state.textContent = `app ${data.version} ligado`
      state.classList.add('on')
      return
    }
  } catch {
    // sem app
  }
  state.textContent = 'abre o WB-DM'
  state.classList.add('off')
}

init()
