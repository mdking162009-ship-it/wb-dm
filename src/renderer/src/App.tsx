import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import iconUrl from './assets/icon.png'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eraser,
  File,
  FileArchive,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Heart,
  Image,
  Music,
  Package,
  Pause,
  PauseCircle,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Settings,
  Sun,
  Moon,
  Minus,
  Square,
  Trash2,
  X,
  XCircle
} from 'lucide-react'
import type { AppSettingsInfo, DownloadItemInfo, LinkGuess } from '../../preload/index'

// onde recebes os donativos: troca pelo teu link (Buy Me a Coffee, ko-fi, PayPal)
// quando criares a tua página de donativo
const DONATE_URL = 'https://ko-fi.com/mamonamd'
const APP_VERSION = '1.0.0'

const TABS = ['todos', 'videos', 'imagens', 'audios', 'documentos', 'arquivos', 'programas', 'outros'] as const
type Tab = (typeof TABS)[number] | 'erro'

const TAB_NAME: Record<string, string> = {
  todos: 'Todos',
  erro: 'Com erro',
  imagens: 'Imagens',
  videos: 'Vídeos',
  audios: 'Áudios',
  documentos: 'Documentos',
  arquivos: 'Arquivos',
  programas: 'Programas',
  outros: 'Outros'
}

const CAT_NAME: Record<string, string> = {
  imagens: 'Imagem',
  videos: 'Vídeo',
  audios: 'Áudio',
  documentos: 'Documento',
  arquivos: 'Arquivo',
  programas: 'Programa',
  outros: 'Outro'
}

const STATUS_NAME = {
  pending: 'Na fila',
  downloading: 'Baixando',
  paused: 'Pausado',
  completed: 'Concluído',
  interrupted: 'Erro'
} as const

const CAT_ICON: Record<string, typeof File> = {
  imagens: Image,
  videos: Film,
  audios: Music,
  documentos: FileText,
  arquivos: FileArchive,
  programas: Package,
  outros: File
}

function fmtBytes(b: number): string {
  if (!b || b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = b
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// o electron manda update a cada ~500ms, então a média fica boa
function fmtSpeed(b: number): string {
  return b > 0 ? `${fmtBytes(b)}/s` : '--'
}

function fmtEta(speed: number, left: number): string {
  if (!speed || left <= 0) return '----'
  const s = Math.round(left / speed)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function merge(list: DownloadItemInfo[], item: DownloadItemInfo): DownloadItemInfo[] {
  const i = list.findIndex((d) => d.id === item.id)
  if (i === -1) return [item, ...list]
  const copy = [...list]
  copy[i] = item
  return copy
}

function StatusIcon({ status }: { status: DownloadItemInfo['status'] }) {
  const cls = 'st-icon'
  switch (status) {
    case 'pending':
      return <Clock size={12} className={cls} />
    case 'downloading':
      return <RefreshCw size={12} className={`${cls} spin`} />
    case 'paused':
      return <PauseCircle size={12} className={cls} />
    case 'completed':
      return <CheckCircle2 size={12} className={cls} />
    case 'interrupted':
      return <XCircle size={12} className={cls} />
  }
}

function Switch({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <label className="setting-row">
      <span className="setting-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={checked ? 'switch on' : 'switch'}>
        <input type="checkbox" checked={checked} onChange={(e): void => onChange(e.target.checked)} />
        <span className="knob" />
      </span>
    </label>
  )
}

export default function App(): React.JSX.Element {
  const [items, setItems] = useState<DownloadItemInfo[]>([])
  const [folder, setFolder] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('todos')
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inputTxt, setInputTxt] = useState('')
  const [badCount, setBadCount] = useState(0)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')
  const [settings, setSettings] = useState<AppSettingsInfo | null>(null)
  const [captureOn, setCaptureOn] = useState(false)
  const [toast, setToast] = useState<LinkGuess[] | null>(null)
  const [guess, setGuess] = useState<LinkGuess | null>(null)
  const [upd, setUpd] = useState<{ latest: string; url?: string } | null>(null)
  const [updMsg, setUpdMsg] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    window.api.getFolder().then(setFolder)
    window.api.getItems().then(setItems)
    window.api.getSettings().then((s) => {
      setSettings(s)
      setCaptureOn(s.captureClipboard)
    })
    const offDl = window.api.onDownloadEvent(({ item }) =>
      setItems((cur) => merge(cur, item))
    )
    const offCaptured = window.api.onCapturedLinks((links) => setToast(links))
    const offUpd = window.api.onUpdateFound((info) => {
      if (info.hasUpdate) setUpd({ latest: info.latest, url: info.url })
    })
    return () => {
      offDl()
      offCaptured()
      offUpd()
    }
  }, [])

  const sel = useMemo(() => items.find((i) => i.id === selected) ?? null, [items, selected])

  const shown = useMemo(() => {
    if (tab === 'todos') return items
    if (tab === 'erro') return items.filter((i) => i.status === 'interrupted')
    return items.filter((i) => i.category === tab)
  }, [items, tab])

  const n = useMemo(
    () => ({
      active: items.filter((i) => ['downloading', 'pending'].includes(i.status)).length,
      paused: items.filter((i) => i.status === 'paused').length,
      done: items.filter((i) => i.status === 'completed').length,
      erro: items.filter((i) => i.status === 'interrupted').length
    }),
    [items]
  )

  const addLinks = useCallback(async (): Promise<void> => {
    if (!inputTxt.trim()) return
    const { added, invalid } = await window.api.addDownloads(inputTxt)
    setItems((cur) => {
      let list = cur
      for (const i of added) list = merge(list, i)
      return list
    })
    setInputTxt('')
    setAddOpen(false)
    setGuess(null)
    setBadCount(invalid.length)
    if (added.length) setSelected(added[0].id)
  }, [inputTxt])

  // identifica extensão/tipo enquanto digita (na primeira linha)
  const detect = useCallback((text: string): void => {
    setInputTxt(text)
    if (timerRef.current) clearTimeout(timerRef.current)
    const first = text.split(/\s+/)[0]
    if (!first) {
      setGuess(null)
      return
    }
    timerRef.current = setTimeout(async () => setGuess(await window.api.guessLink(first)), 250)
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettingsInfo>): Promise<void> => {
    const next = await window.api.setSettings(patch)
    setSettings(next)
    setCaptureOn(next.captureClipboard)
  }, [])

  const finished = ['completed', 'interrupted']

  const clearBtn = async (): Promise<void> => {
    await window.api.clearFinished()
    setItems((cur) => cur.filter((i) => !finished.includes(i.status)))
    setSelected(null)
  }

  const removeBtn = async (): Promise<void> => {
    if (!sel || !finished.includes(sel.status)) return
    await window.api.removeDownload(sel.id)
    setItems((cur) => cur.filter((i) => i.id !== sel.id))
    setSelected(null)
  }

  const busy = ['downloading', 'paused', 'pending']

  const GuessType = guess ? (CAT_ICON[guess.category] ?? File) : null

  return (
    <div className="app">
      <header className="titlebar">
        <div className="titlebar-drag">
          <img src={iconUrl} className="titlebar-icon" alt="" draggable={false} />
          <span className="titlebar-name">WB-DM — White Black Download Manager</span>
        </div>
        <div className="titlebar-actions">
          <button className="wb-btn" title="Minimizar" onClick={(): void => window.api.windowMinimize()}>
            <Minus size={15} />
          </button>
          <button className="wb-btn" title="Maximizar" onClick={(): void => window.api.windowMaximize()}>
            <Square size={12} />
          </button>
          <button className="wb-btn close" title="Fechar" onClick={(): void => window.api.windowClose()}>
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="toolbar">
        <div className="toolbar-group">
          <button className="tb accent" onClick={(): void => setAddOpen(true)}>
            <Plus size={14} /> Adicionar
          </button>
          <span className="tb-divider" />
          <button
            className="tb"
            disabled={!sel || sel.status !== 'downloading'}
            onClick={(): Promise<void> => window.api.pauseDownload(sel!.id)}
          >
            <Pause size={14} /> Pausar
          </button>
          <button
            className="tb"
            disabled={!sel || sel.status !== 'paused'}
            onClick={(): Promise<void> => window.api.resumeDownload(sel!.id)}
          >
            <Play size={14} /> Retomar
          </button>
          <button
            className="tb"
            disabled={!sel || !busy.includes(sel.status)}
            onClick={(): Promise<void> => window.api.cancelDownload(sel!.id)}
          >
            <X size={14} /> Cancelar
          </button>
          <button className="tb" disabled={!sel || busy.includes(sel.status)} onClick={removeBtn}>
            <Trash2 size={14} /> Remover
          </button>
        </div>
        <div className="toolbar-group">
          <button
            className={captureOn ? 'tb capture on' : 'tb capture'}
            title="Capturador de links via área de transferência"
            onClick={(): Promise<void> => {
              setCaptureOn(!captureOn)
              return saveSettings({ captureClipboard: !captureOn })
            }}
          >
            <Radar size={14} /> Capturador
          </button>
          <button className="tb" disabled={n.done + n.erro === 0} onClick={clearBtn}>
            <Eraser size={14} /> Limpar
          </button>
          <span className="tb-divider" />
          <button
            className="tb"
            onClick={async (): Promise<void> => {
              const next = await window.api.chooseFolder()
              if (next) setFolder(next)
            }}
          >
            <Folder size={14} /> Pasta
          </button>
          <button className="tb" onClick={(): Promise<void> => window.api.openFolder()}>
            <FolderOpen size={14} /> Abrir
          </button>
          <span className="tb-divider" />
          <button className="tb" onClick={(): void => setDark(!dark)}>
            {dark ? <Sun size={14} /> : <Moon size={14} />} Tema
          </button>
          <button
            className="tb"
            title="Definições"
            onClick={(): void => setSettingsOpen(true)}
          >
            <Settings size={14} /> Definições
          </button>
        </div>
      </div>

      {badCount > 0 && (
        <div className="invalid" onClick={(): void => setBadCount(0)}>
          {badCount} link(s) inválido(s) ou já na fila — clique p/ fechar
        </div>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={(): void => setTab(t)}>
            {TAB_NAME[t]} <small>{t === 'todos' ? items.length : items.filter((i) => i.category === t).length}</small>
          </button>
        ))}
        {n.erro > 0 && (
          <button className={tab === 'erro' ? 'tab active' : 'tab'} onClick={(): void => setTab('erro')}>
            {TAB_NAME.erro} <small className="tab-err">{n.erro}</small>
          </button>
        )}
      </div>

      <div className="table-wrap card">
        <table className="dl-table">
          <thead>
            <tr>
              <th className="col-type">Tipo</th>
              <th className="col-name">Nome do arquivo</th>
              <th className="col-idx">Tamanho</th>
              <th className="col-progress">Progresso</th>
              <th className="col-idx">Velocidade</th>
              <th className="col-idx">Restante</th>
              <th className="col-status">Situação</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  <img src={iconUrl} className="hero-icon" alt="WB-DM" />
                  <p className="hero-name">WB-DM — White Black Download Manager</p>
                  <p className="empty-sub">Nada aqui. <strong>Adicionar</strong> pra começar a baixar.</p>
                </td>
              </tr>
            )}
            {shown.map((i) => {
              const pct =
                i.totalBytes > 0 ? Math.min(100, (i.receivedBytes / i.totalBytes) * 100) : i.status === 'completed' ? 100 : 0
              const CatIcon = CAT_ICON[i.category] ?? File
              return (
                <tr
                  key={i.id}
                  className={i.id === selected ? 'row selected' : 'row'}
                  onClick={(): void => setSelected(i.id)}
                  onDoubleClick={(): void => {
                    if (i.status === 'completed') window.api.openItem(i.id)
                    else window.api.openFolder()
                  }}
                  title={i.url}
                >
                  <td className="col-type">
                    <span className={`badge cat-${i.category}`}>
                      <CatIcon size={11} /> {CAT_NAME[i.category] ?? i.category}
                    </span>
                  </td>
                  <td className="col-name" title={i.url}>
                    {i.filename}
                  </td>
                  <td className="col-idx">{i.totalBytes > 0 ? fmtBytes(i.totalBytes) : '—'}</td>
                  <td className="col-progress">
                    {i.status === 'downloading' ? (
                      <div className="progress-wrap">
                        <div className="progress">
                          <div className="fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="pct">{pct.toFixed(1)}%</span>
                      </div>
                    ) : i.status === 'completed' ? (
                      <div className="progress">
                        <div className="fill done" style={{ width: '100%' }} />
                      </div>
                    ) : (
                      <span className="no-progress">—</span>
                    )}
                  </td>
                  <td className="col-idx">{i.status === 'downloading' ? fmtSpeed(i.speed) : '--'}</td>
                  <td className="col-idx">
                    {i.status === 'downloading' && i.totalBytes > 0
                      ? fmtEta(i.speed, i.totalBytes - i.receivedBytes)
                      : '----'}
                  </td>
                  <td className={`col-status st-${i.status}`}>
                    <StatusIcon status={i.status} />
                    {i.status === 'interrupted' && i.error ? i.error : STATUS_NAME[i.status]}
                    {i.error ? (
                      <span className="err-tip" title={i.error}>
                        <AlertCircle size={12} />
                      </span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="statusbar">
        <div className="status-blocks">
          <span className="sb sb-active">{n.active} baixando</span>
          <span className="sb sb-paused">{n.paused} pausados</span>
          <span className="sb sb-done">{n.done} concluídos</span>
          <span className="sb sb-err">{n.erro} erros</span>
          <span className={captureOn ? 'sb sb-capture on' : 'sb sb-capture'}>
            <Radar size={11} /> capturador {captureOn ? 'ativo' : 'off'}
          </span>
        </div>
        <span className="sb-folder" title={folder}>
          {folder}
        </span>
      </div>

      {/* aviso de nova versão */}
      {upd && (
        <div className="toast upd-toast">
          <div className="toast-head">
            <RefreshCw size={14} />
            <strong>Nova versão {upd.latest} disponível</strong>
            <button className="close" onClick={(): void => setUpd(null)}>
              <X size={12} />
            </button>
          </div>
          <p>WB-DM {upd.latest} já está no GitHub — baixa a atualização quando quiseres.</p>
          <div className="toast-actions">
            <button onClick={(): void => setUpd(null)}>Mais tarde</button>
            {upd.url ? (
              <a className="primary upd-link" href={upd.url} target="_blank" rel="noreferrer">
                Abrir página
              </a>
            ) : null}
          </div>
        </div>
      )}

      {/* toast do capturador */}
      {toast && toast.length > 0 && (
        <div className="toast">
          <div className="toast-head">
            <Radar size={14} />
            <strong>Link(s) capturado(s)</strong>
            <button className="close" onClick={(): void => setToast(null)}>
              <X size={12} />
            </button>
          </div>
          <ul>
            {toast.slice(0, 4).map((g, idx) => (
              <li key={idx}>
                <strong>{g.filename}</strong> — {CAT_NAME[g.category] ?? g.category}
                {g.ext ? ` (.${g.ext})` : ''}
              </li>
            ))}
            {toast.length > 4 && <li>+ {toast.length - 4} outros</li>}
          </ul>
          <div className="toast-actions">
            <button onClick={(): void => setToast(null)}>Descartar</button>
            <button
              className="primary"
              onClick={async (): Promise<void> => {
                await window.api.addDownloads(toast.map((g) => g.url).join('\n'))
                setToast(null)
              }}
            >
              Baixar todos
            </button>
          </div>
        </div>
      )}

      {/* modal adicionar */}
      {addOpen && (
        <div className="modal-overlay" onClick={(): void => setAddOpen(false)}>
          <div className="modal card" onClick={(e): void => e.stopPropagation()}>
            <div className="modal-title">
              <strong>Adicionar links</strong>
              <button className="close" onClick={(): void => setAddOpen(false)}>
                <X size={13} />
              </button>
            </div>
            <p className="modal-hint">Um link por linha — o tipo é identificado pela extensão</p>
            <textarea
              autoFocus
              value={inputTxt}
              onChange={(e): void => detect(e.target.value)}
              onKeyDown={(e): void => {
                if (e.ctrlKey && e.key === 'Enter') addLinks()
              }}
              placeholder={'https://exemplo.com/video.mp4\nhttps://exemplo.com/foto.jpg'}
              rows={6}
              spellCheck={false}
            />
            {guess && GuessType && (
              <div className="guess">
                <GuessType size={14} />
                <span>
                  Detectado: <strong>{CAT_NAME[guess.category] ?? 'desconhecido'}</strong>
                  {guess.ext ? ` · .${guess.ext}` : ''} — {guess.filename}
                </span>
              </div>
            )}
            <div className="modal-actions">
              <button onClick={(): void => setAddOpen(false)}>Cancelar</button>
              <button className="primary" onClick={addLinks} disabled={!inputTxt.trim()}>
                <Plus size={13} /> Baixar
              </button>
            </div>
            <p className="modal-foot">Ctrl+Enter também fecha e baixa</p>
          </div>
        </div>
      )}

      {/* modal definições */}
      {settingsOpen && settings && (
        <div className="modal-overlay" onClick={(): void => setSettingsOpen(false)}>
          <div className="modal card settings-modal" onClick={(e): void => e.stopPropagation()}>
            <div className="modal-title">
              <strong>Definições</strong>
              <button className="close" onClick={(): void => setSettingsOpen(false)}>
                <X size={13} />
              </button>
            </div>

            <h3>Aparência</h3>
            <Switch
              checked={dark}
              onChange={setDark}
              label="Tema escuro"
              hint="Interface em tons noturnos"
            />

            <h3>Geral</h3>
            <Switch
              checked={settings.subfolders}
              onChange={(v): Promise<void> => saveSettings({ subfolders: v })}
              label="Organizar em subpastas"
              hint="Videos, Imagens, Documentos... dentro da pasta escolhida"
            />
            <Switch
              checked={settings.askSave}
              onChange={(v): Promise<void> => saveSettings({ askSave: v })}
              label="Perguntar onde salvar cada download"
              hint="Abre o diálogo do Windows pra escolher o destino"
            />
            <label className="setting-row">
              <span className="setting-label">
                Downloads simultâneos<small>Limite de downloads ao mesmo tempo (1 a 8)</small>
              </span>
              <select
                value={settings.maxConcurrent}
                onChange={(e): Promise<void> => saveSettings({ maxConcurrent: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-row">
              <span className="setting-label">
                Segmentos por download<small>
                  Conexões em paralelo (1 a 16) — mais = mais veloz, estilo IDM. Cai pra conexão única
                  se o servidor não suportar
                </small>
              </span>
              <select
                value={settings.segments}
                onChange={(e): Promise<void> => saveSettings({ segments: Number(e.target.value) })}
              >
                {[1, 2, 4, 6, 8, 12, 16].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <h3>Actualizações</h3>
            <Switch
              checked={settings.checkUpdates}
              onChange={(v): Promise<void> => saveSettings({ checkUpdates: v })}
              label="Procurar atualizações automaticamente"
              hint="Avisa no app quando houver versão nova no GitHub"
            />
            <div className="setting-row upd-check-row">
              <button
                className="tb"
                onClick={async (): Promise<void> => {
                  setUpdMsg('A verificar...')
                  const info = await window.api.checkForUpdate()
                  setUpdMsg(
                    info.hasUpdate
                      ? `Nova versão: ${info.latest}. Baixa em releases do GitHub`
                      : `Estás na versão mais recente (${info.current})`
                  )
                  if (info.hasUpdate) setUpd({ latest: info.latest, url: info.url })
                  setTimeout(() => setUpdMsg(''), 8000)
                }}
              >
                <RefreshCw size={13} /> Verificar agora
              </button>
              {updMsg && <small className="upd-msg">{updMsg}</small>}
            </div>

            <h3>Capturador de links</h3>
            <Switch
              checked={settings.captureClipboard}
              onChange={(v): Promise<void> => saveSettings({ captureClipboard: v })}
              label="Monitorar área de transferência"
              hint="Detecta links copiados (Ctrl+C) no PC todo"
            />
            <Switch
              checked={settings.captureAutoDownload}
              onChange={(v): Promise<void> => saveSettings({ captureAutoDownload: v })}
              label="Baixar links capturados automaticamente"
              hint="Sem pedir confirmação"
            />

            <h3>Apoiar o projecto</h3>
            <div className="donate-row">
              <div className="donate-text">
                <strong>WB-DM {APP_VERSION}</strong>
                <small>
                  Grátis e sem publicidade. Se o app te poupa tempo, um café ajuda a continuar a
                  evoluir
                </small>
              </div>
              <a className="donate-btn" href={DONATE_URL} target="_blank" rel="noreferrer">
                <Heart size={13} /> Doar
              </a>
            </div>

            <div className="modal-actions">
              <button className="primary" onClick={(): void => setSettingsOpen(false)}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
