// captura inteligente: corre nas paginas e descobre links diretos de download
// (mediafire tem um botao de download com href direto; outros sitios tem <a> com extensoes de ficheiro)
;(function () {
  const FILE_EXTS = new Set([
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'apk', 'exe', 'msi',
    'mp4', 'mkv', 'webm', 'mov', 'avi', 'ts', 'mp3', 'wav', 'flac', 'ogg', 'm4a',
    'pdf', 'epub', 'docx', 'xlsx', 'pptx'
  ])
  const seen = new Set()
  let pending

  function absolute(href) {
    try {
      const u = new URL(href, location.href)
      u.hash = ''
      return u.href
    } catch {
      return null
    }
  }

  function isDownloadHref(a) {
    if (a.hasAttribute('download')) return true
    const href = absolute(a.getAttribute('href') || '')
    if (!href || !/https?:/i.test(href)) return null
    // mediafire: o botao grande de download ja e o link direto do ficheiro
    if (a.id === 'downloadButton' || /download\d*\.mediafire\.com\/|\.mediafire\.com\/file\//i.test(href)) return href
    const ext = (href.split('?')[0].split('.').pop() || '').toLowerCase()
    return FILE_EXTS.has(ext) ? href : null
  }

  function scan() {
    const found = []
    for (const a of document.querySelectorAll('a[href]')) {
      const href = isDownloadHref(a)
      if (href && !seen.has(href)) {
        seen.add(href)
        found.push(href)
      }
      if (found.length >= 6) break
    }
    if (found.length > 0) {
      chrome.runtime.sendMessage({ type: 'wb-smart', urls: found }).catch(() => {})
    }
  }

  const throttle = () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = undefined
      scan()
    }, 1200)
  }

  throttle()
  new MutationObserver(throttle).observe(document.documentElement, { childList: true, subtree: true })
})()
