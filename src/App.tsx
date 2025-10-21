import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet'
import {
  DistanceProvider,
  buildDistanceMatrix,
  nearestNeighbor,
  twoOpt,
  routeLength,
  fetchOsrmRouteGeoJSON,
  haversineKm
} from './utils/routing'
import SelectedCards from './components/SelectedCards'
import { onlineEnabled } from './lib/supabase'
import { listCompletions, setCompletion, subscribeCompletions } from './services/completions'
import './styles/theme.css'
import './styles/highlight.css'

type Trafo = { id: string; base: string; perda: number; lat: number; lon: number }
type SelectionStrategy = 'loss' | 'proximity'
type CompletedMap = Record<string, Record<string, boolean>>
type EndMode = 'return_base' | 'end_last' | 'custom'

const COMPLETED_KEY = 'rota-trafos:completed'

// Marcadores menores (fácil de ajustar aqui)
const MARKER = {
  base: 5,                       // antes ~7
  all: { normal: 3, hover: 5 },  // antes ~5/7
  selected: { normal: 5, hover: 7 }, // antes ~7/9
}

// Persistência local (fallback offline)
function loadCompletedLocal(): CompletedMap {
  try {
    const raw = localStorage.getItem(COMPLETED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch { return {} }
}
function saveCompletedLocal(map: CompletedMap) {
  try { localStorage.setItem(COMPLETED_KEY, JSON.stringify(map)) } catch {}
}
function getDone(map: CompletedMap, base: string, id: string) { return !!map[base]?.[id] }
function setDone(map: CompletedMap, base: string, id: string, val: boolean): CompletedMap {
  const next: CompletedMap = { ...map }
  if (!next[base]) next[base] = {}
  if (val) next[base][id] = true
  else delete next[base][id]
  return next
}

/* ==== CSV utils (BR ; e vírgula decimal) ==== */
const HEADER_MAP: Record<string, 'id' | 'base' | 'perda' | 'lat' | 'lon'> = {
  BASE: 'base', MFINSTALLA: 'id', PERDA: 'perda', LATI: 'lat', LONG: 'lon',
  'MEDIDOR FISCAL (TRAFO)': 'id', 'MEDIDOR FISCAL': 'id', TRAFO: 'id', ID: 'id',
  CIDADE: 'base', REGIAO: 'base', 'REGIÃO': 'base',
  LAT: 'lat', LATITUDE: 'lat', LON: 'lon', LNG: 'lon', LONGITUDE: 'lon',
  PERDAS: 'perda', LOSS: 'perda',
}
function cleanHeader(h: string) { return String(h || '').replace(/^\uFEFF/, '').trim().toUpperCase() }
function toNumBR(v: any): number { const s = String(v ?? '').trim(); return s ? Number(s.replace(/\./g, '').replace(',', '.')) : NaN }
function splitLines(text: string): string[] { return text.split(/\r?\n/).filter(l => l.trim().length > 0) }
function looksMojibake(s: string) { return s.includes('\uFFFD') || s.includes('�') || /Ã.|Â./.test(s) }
function parseCsvFlexible(text: string, delimiter = ';'): Trafo[] {
  const lines = splitLines(text); if (lines.length < 2) return []
  let headerIdx = 0; while (headerIdx < lines.length && lines[headerIdx].split(delimiter).length < 3) headerIdx++
  if (headerIdx >= lines.length) return []
  const headerCols = lines[headerIdx].split(delimiter).map(cleanHeader)
  const mapped = headerCols.map(h => HEADER_MAP[h])
  const out: Trafo[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter); if (parts.length < headerCols.length) continue
    const rec: any = { id: '', base: '', perda: NaN, lat: NaN, lon: NaN }
    parts.forEach((val, idx) => {
      const key = mapped[idx]; if (!key) return
      if (key === 'perda' || key === 'lat' || key === 'lon') rec[key] = toNumBR(val)
      else rec[key] = String(val ?? '').trim()
    })
    if (!rec.id || !rec.base) continue
    if ([rec.perda, rec.lat, rec.lon].some((n: number) => Number.isNaN(n))) continue
    if (rec.lat < -90 || rec.lat > 90) continue
    if (rec.lon < -180 || rec.lon > 180) continue
    out.push(rec as Trafo)
  }
  return out
}
async function loadCsvFromPublic(path: string, delimiter = ';'): Promise<Trafo[]> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Falha ao carregar ${path}: ${res.status} ${res.statusText}`)
  const buf = await res.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)
  if (looksMojibake(text)) {
    try { text = new TextDecoder('windows-1252').decode(buf) } catch {}
  }
  return parseCsvFlexible(text, delimiter)
}
function readLocalCsvFile(file: File): Promise<Trafo[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try { resolve(parseCsvFlexible(reader.result as string, ';')) } catch (e) { reject(e) }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/* ==== Pan controlado ==== */
function FlyTo({ center }: { center?: [number, number] }) {
  const map = useMap()
  useEffect(() => { if (center) map.panTo(center, { animate: true, duration: 0.4 as any }) }, [center, map])
  return null
}

/* ==== Helpers de cor (paleta por perda) ==== */
function clamp01(x: number) { return Math.max(0, Math.min(1, x)) }
function hslStr(h: number, s: number, l: number) { return `hsl(${h} ${s}% ${l}%)` }
function hslaStr(h: number, s: number, l: number, a: number) { return `hsl(${h} ${s}% ${l}% / ${a})` }

export default function App() {
  // Tema
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as any) || 'dark')
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Equipe (multi-equipes online)
  const [team, setTeam] = useState<string>(() => localStorage.getItem('team') || '')
  useEffect(() => { localStorage.setItem('team', team) }, [team])

  // Dados e filtros
  const [rows, setRows] = useState<Trafo[]>([])
  const [baseSel, setBaseSel] = useState<string>('')
  const [searchId, setSearchId] = useState<string>('')

  // Concluídos (cache local; sincroniza com Supabase quando online)
  const [completed, setCompleted] = useState<CompletedMap>({})
  const [hideCompletedOnMap, setHideCompletedOnMap] = useState<boolean>(false)

  // Estratégia
  const [strategy, setStrategy] = useState<SelectionStrategy>('loss')
  const [topN, setTopN] = useState<number>(10)
  const [radiusKm, setRadiusKm] = useState<number>(1.0)

  // Custo
  const [distanceProvider, setDistanceProvider] = useState<DistanceProvider>('haversine')
  const [providerUsed, setProviderUsed] = useState<DistanceProvider>('haversine')

  // Base / destino
  const [baseLat, setBaseLat] = useState<number>(-6.52)
  const [baseLon, setBaseLon] = useState<number>(-49.83)
  const [endMode, setEndMode] = useState<EndMode>('return_base')
  const [customDestLat, setCustomDestLat] = useState<number | ''>('')
  const [customDestLon, setCustomDestLon] = useState<number | ''>('')

  // Seleção e rota
  const [selected, setSelected] = useState<Trafo[]>([])
  const [routeOrder, setRouteOrder] = useState<number[]>([]) // inclui 0=BASE
  const [routeCoords, setRouteCoords] = useState<[number, number][]>([])
  const [totalKm, setTotalKm] = useState<number>(0)
  const [totalMin, setTotalMin] = useState<number>(0)
  const [gmapsUrl, setGmapsUrl] = useState<string>('')
  const [dmUsed, setDmUsed] = useState<number[][] | null>(null)

  // UX e integração
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [panCoord, setPanCoord] = useState<[number, number] | null>(null)
  const [burstId, setBurstId] = useState<string | null>(null)
  const [badgePulse, setBadgePulse] = useState<{ id: string, kind: 'complete' | 'undo' } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // Geolocalização
  const [locating, setLocating] = useState<boolean>(false)
  const [locError, setLocError] = useState<string>('')

  // Boot inicial: concluídos offline (se aplicável) + CSV default
  useEffect(() => {
    if (!onlineEnabled) setCompleted(loadCompletedLocal())
    loadCsvFromPublic('/csv.CSV', ';')
      .then(data => {
        setRows(data)
        const firstBase = data[0]?.base ?? ''
        setBaseSel(firstBase)
        const group = data.filter(d => d.base === firstBase)
        if (group.length) {
          const lat = group.reduce((s, r) => s + r.lat, 0) / group.length
          const lon = group.reduce((s, r) => s + r.lon, 0) / group.length
          setBaseLat(lat); setBaseLon(lon)
        }
      })
      .catch(err => console.error('Erro CSV default:', err))
  }, [])

  // Minha localização
  async function useMyLocation() {
    setLocError('')
    if (!('geolocation' in navigator)) { setLocError('Geolocalização não suportada.'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setBaseLat(latitude); setBaseLon(longitude)
        setLocating(false)
        clearRoute()
        setPanCoord([latitude, longitude])
      },
      (err) => {
        setLocating(false)
        if (err.code === err.PERMISSION_DENIED) setLocError('Permissão negada.')
        else if (err.code === err.POSITION_UNAVAILABLE) setLocError('Indisponível.')
        else if (err.code === err.TIMEOUT) setLocError('Timeout.')
        else setLocError('Falha ao obter localização.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  }

  // Bases/linhas por base
  const bases = useMemo(() => Array.from(new Set(rows.map(r => r.base))).sort(), [rows])
  const rowsByBase = useMemo(() => rows.filter(r => r.base === baseSel), [rows, baseSel])

  // Filtro por MF
  const viewFiltered = useMemo(() => {
    const q = searchId.trim().toLowerCase()
    return rowsByBase
      .filter(r => !q || r.id.toLowerCase().includes(q))
      .sort((a, b) => b.perda - a.perda)
  }, [rowsByBase, searchId])

  const rowsForSelection = useMemo(() => viewFiltered, [viewFiltered])

  // Paleta por perda (domínio por base)
  const lossDomain = useMemo(() => {
    if (!rowsByBase.length) return { min: 0, max: 1 }
    const vals = rowsByBase.map(r => r.perda)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    return { min, max }
  }, [rowsByBase])
  function lossNorm(v: number) {
    const { min, max } = lossDomain
    if (max - min <= 1e-9) return 1
    return clamp01((v - min) / (max - min))
  }
  function lossHsl(perda: number) {
    const t = lossNorm(perda)
    const h = Math.round(120 * (1 - t)) // 120 (verde) -> 0 (vermelho)
    const s = 85
    const l = theme === 'dark' ? 52 : 45
    return { h, s, l }
  }
  function chipStyleForLoss(perda: number): React.CSSProperties {
    const { h, s, l } = lossHsl(perda)
    return { background: hslaStr(h, s, l, 0.16), borderColor: hslaStr(h, s, l, 0.55), color: 'var(--text)' }
  }

  // Recentrar e limpar rota ao trocar a base
  function recenterToBase(base: string) {
    const group = rows.filter(r => r.base === base)
    if (!group.length) return
    const lat = group.reduce((s, r) => s + r.lat, 0) / group.length
    const lon = group.reduce((s, r) => s + r.lon, 0) / group.length
    setBaseLat(lat); setBaseLon(lon); setPanCoord([lat, lon])
  }
  useEffect(() => {
    if (!baseSel) return
    recenterToBase(baseSel)
    clearRoute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseSel])

  // Online: carregar concluídos e assinar realtime por (team+base)
  useEffect(() => {
    if (!onlineEnabled) return
    if (!team || !baseSel) return

    let unsub: { unsubscribe: () => void } | null = null
    let cancelled = false

    async function boot() {
      const serverSet = await listCompletions(team, baseSel)
      if (cancelled) return
      setCompleted(prev => {
        const next = { ...prev }
        next[baseSel] = {}
        serverSet.forEach(id => { next[baseSel][id] = true })
        return next
      })
      unsub = subscribeCompletions(team, baseSel, (trafoId, done) => {
        setCompleted(prev => setDone(prev, baseSel, trafoId, done))
      })
    }
    boot()

    return () => {
      cancelled = true
      unsub?.unsubscribe()
    }
  }, [team, baseSel])

  // Offline fallback: salvar no localStorage
  useEffect(() => {
    if (!onlineEnabled) saveCompletedLocal(completed)
  }, [completed])

  // Ações
  function autoCenterBase() {
    const group = rows.filter(r => r.base === baseSel)
    if (!group.length) return
    const lat = group.reduce((s, r) => s + r.lat, 0) / group.length
    const lon = group.reduce((s, r) => s + r.lon, 0) / group.length
    setBaseLat(lat); setBaseLon(lon); setPanCoord([lat, lon])
  }
  function toggleDoneUI(trafo: Trafo) {
    const willBeDone = !getDone(completed, trafo.base, trafo.id)
    setCompleted(prev => setDone(prev, trafo.base, trafo.id, willBeDone))
    if (onlineEnabled) {
      setCompletion(team, trafo.base, trafo.id, willBeDone, 'web')
    } else {
      saveCompletedLocal(setDone(completed, trafo.base, trafo.id, willBeDone))
    }
    setBadgePulse({ id: trafo.id, kind: willBeDone ? 'complete' : 'undo' })
    window.setTimeout(() => setBadgePulse(prev => (prev?.id === trafo.id ? null : prev)), 1150)
  }

  function densestNeighborsFallback(points: [number, number][], radiusKm: number, topN: number): number[] {
    const n = points.length
    if (!n) return []
    const counts = new Array(n).fill(0)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = haversineKm(points[i][0], points[i][1], points[j][0], points[j][1])
      if (d <= radiusKm) counts[i]++
    }
    let center = 0
    for (let i = 1; i < n; i++) if (counts[i] > counts[center]) center = i
    const dists = points.map((p, idx) => ({ idx, d: haversineKm(points[center][0], points[center][1], p[0], p[1]) }))
    dists.sort((a, b) => a.d - b.d)
    return dists.slice(0, topN).map(r => r.idx)
  }

  function computeSelection(): Trafo[] {
    if (!rowsForSelection.length) { alert('Nenhum trafo disponível com os filtros atuais.'); return [] }
    if (strategy === 'loss') {
      const pool = rowsForSelection
      if (!pool.length) { alert('Nenhum trafo atende ao limite.'); return [] }
      return pool.slice(0, topN)
    } else {
      const coords = rowsForSelection.map(r => [r.lat, r.lon] as [number, number])
      const idxs = densestNeighborsFallback(coords, radiusKm, Math.min(topN, coords.length))
      let cluster = idxs.map(i => rowsForSelection[i])
      if (cluster.length > topN) cluster = cluster.sort((a, b) => b.perda - a.perda).slice(0, topN)
      return cluster
    }
  }

  function isClosedTour(): boolean { return endMode === 'return_base' }

  function getDestAfterOrdering(ordered: [number, number][]): [number, number] {
    if (endMode === 'return_base') return ordered[0]
    if (endMode === 'end_last') return ordered[ordered.length - 1]
    const clat = Number(customDestLat), clon = Number(customDestLon)
    if (Number.isFinite(clat) && Number.isFinite(clon)) return [clat, clon]
    return ordered[ordered.length - 1]
  }

  async function generateRoute() {
    const sel = computeSelection()
    if (!sel.length) return
    setSelected(sel)

    const coordsWithBase: [number, number][] = [[baseLat, baseLon], ...sel.map(s => [s.lat, s.lon] as [number, number])]
    const { dm, providerUsed } = await buildDistanceMatrix(distanceProvider, coordsWithBase)
    setDmUsed(dm); setProviderUsed(providerUsed)

    const nn = nearestNeighbor(dm, 0)
    const improved = twoOpt(nn, dm, isClosedTour())
    setRouteOrder(improved)

    const total = routeLength(improved, dm, isClosedTour())
    if (providerUsed === 'osrm-duration') { setTotalMin(total); setTotalKm(0) } else { setTotalKm(total); setTotalMin(0) }

    const ordered = improved.map(i => coordsWithBase[i])
    const closed = isClosedTour()
    const seq = (closed && ordered.length > 1) ? [...ordered, ordered[0]] : ordered

    if (providerUsed === 'osrm' || providerUsed === 'osrm-duration') {
      const geo = await fetchOsrmRouteGeoJSON(seq)
      setRouteCoords(geo ?? seq)
    } else {
      setRouteCoords(seq)
    }

    const origin = ordered[0]
    const dest = getDestAfterOrdering(ordered)
    const waypoints = ordered.slice(1)
    setGmapsUrl(buildGoogleMapsLink(origin as [number, number], waypoints as [number, number][], dest as [number, number]))
  }

  function clearRoute() {
    setSelected([]); setRouteOrder([]); setRouteCoords([]); setTotalKm(0); setTotalMin(0); setGmapsUrl(''); setDmUsed(null)
  }

  function exportCsv() {
    if (!selected.length || !routeOrder.length) { alert('Gere a rota primeiro.'); return }
    const coordsWithBase: [number, number][] = [[baseLat, baseLon], ...selected.map(s => [s.lat, s.lon] as [number, number])]
    const labelsWithBase: string[] = ['BASE', ...selected.map(s => s.id)]
    const perdasWithBase: (number | '')[] = ['', ...selected.map(s => s.perda)]

    let cumul = 0
    const rowsOut: any[] = []
    for (let i = 0; i < routeOrder.length; i++) {
      const idx = routeOrder[i]
      const [lat, lon] = coordsWithBase[idx]
      const label = labelsWithBase[idx]
      const perda = perdasWithBase[idx]
      let trecho = 0
      if (i > 0) {
        const prev = routeOrder[i - 1]
        trecho = dmUsed ? dmUsed[prev][idx] : haversineKm(coordsWithBase[prev][0], coordsWithBase[prev][1], lat, lon)
        cumul += trecho
      }
      rowsOut.push({
        ordem: i + 1, id: label, lat, lon, perda,
        ...(providerUsed === 'osrm-duration'
          ? { tempo_desde_anterior_min: trecho.toFixed(2), tempo_acumulado_min: cumul.toFixed(2) }
          : { distancia_desde_anterior_km: trecho.toFixed(3), distancia_acumulada_km: cumul.toFixed(3) })
      })
    }
    if (isClosedTour() && routeOrder.length > 1) {
      const last = routeOrder[routeOrder.length - 1], first = routeOrder[0]
      const back = dmUsed ? dmUsed[last][first] : haversineKm(coordsWithBase[last][0], coordsWithBase[last][1], coordsWithBase[first][0], coordsWithBase[first][1])
      cumul += back
      rowsOut.push({
        ordem: rowsOut.length + 1, id: 'BASE (retorno)',
        lat: coordsWithBase[first][0], lon: coordsWithBase[first][1], perda: '',
        ...(providerUsed === 'osrm-duration'
          ? { tempo_desde_anterior_min: back.toFixed(2), tempo_acumulado_min: cumul.toFixed(2) }
          : { distancia_desde_anterior_km: back.toFixed(3), distancia_acumulada_km: cumul.toFixed(3) })
      })
    }

    const header = Object.keys(rowsOut[0]).join(',')
    const lines = rowsOut.map(r => Object.values(r).map(v => String(v)).join(','))
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'rota_trafos.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function buildGoogleMapsLink(origin: [number, number], waypoints: [number, number][], dest: [number, number]) {
    const fmt = (c: [number, number]) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`
    const maxWps = 23
    const base = 'https://www.google.com/maps/dir/?api=1'
    const o = fmt(origin), d = fmt(dest)
    const wps = waypoints.slice(0, maxWps).map(fmt).join('|')
    let url = `${base}&origin=${encodeURIComponent(o)}&destination=${encodeURIComponent(d)}&travelmode=driving`
    if (wps) url += `&waypoints=${encodeURIComponent(wps)}`
    return url
  }

  function triggerFocusBurst(id: string) { setBurstId(id); window.setTimeout(() => setBurstId(prev => (prev === id ? null : prev)), 1300) }
  function onMarkerClick(id: string) {
    const p = selected.find(s => s.id === id) ?? rowsByBase.find(r => r.id === id)
    if (p) { setPanCoord([p.lat, p.lon]); triggerFocusBurst(id) }
  }

  const orderNumbers = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    if (!routeOrder.length || !selected.length) return map
    routeOrder.slice(1).forEach((idxInCoords, stepIdx) => {
      const idxInSelected = idxInCoords - 1
      const s = selected[idxInSelected]
      if (s) map[s.id] = stepIdx + 1
    })
    return map
  }, [routeOrder, selected])

  const legendGradient = useMemo(() => {
    const steps = 10
    const colors = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps
      const perda = lossDomain.min + t * (lossDomain.max - lossDomain.min)
      const { h, s, l } = lossHsl(perda)
      return hslStr(h, s, l)
    })
    return `linear-gradient(90deg, ${colors.join(',')})`
  }, [lossDomain, theme])

  return (
    <div className="app">
      {/* Painel esquerdo */}
      <div className="panel">
        <h2>Planejador de Rotas de Trafos</h2>

        {/* Aparência */}
        <div className="input">
          <h3>Aparência</h3>
          <div className="row">
            <div>
              <label>Tema</label>
              <select value={theme} onChange={e => setTheme(e.target.value as any)}>
                <option value="dark">Escuro</option>
                <option value="light">Claro</option>
              </select>
            </div>
            <div>
              <label>Equipe</label>
              <input type="text" placeholder="ex.: equipe-norte" value={team} onChange={e => setTeam(e.target.value.trim())} />
              <div className="small">Concluídos em tempo real por “Equipe + Base”.</div>
              {!onlineEnabled && <div className="small" style={{ color: '#f87171' }}>Supabase não configurado — funcionando offline (local).</div>}
            </div>
          </div>
        </div>

        <hr />

        {/* Dados */}
        <div className="input">
          <label>Carregar outro CSV (separador ;, vírgula decimal)</label>
          <input ref={fileRef} type="file" accept=".csv" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const data = await readLocalCsvFile(f)
              setRows(data)
              const firstBase = data[0]?.base ?? ''
              setBaseSel(firstBase)
              if (firstBase) {
                const group = data.filter(d => d.base === firstBase)
                if (group.length) {
                  const lat = group.reduce((s, r) => s + r.lat, 0) / group.length
                  const lon = group.reduce((s, r) => s + r.lon, 0) / group.length
                  setBaseLat(lat); setBaseLon(lon); setPanCoord([lat, lon])
                }
              }
              clearRoute()
            } catch (err: any) {
              alert(`Erro ao ler CSV: ${err?.message ?? err}`)
            } finally {
              if (fileRef.current) fileRef.current.value = ''
            }
          }} />
          <div className="small">Padrão: tenta carregar public/csv.CSV automaticamente.</div>
        </div>

        <hr />

        {/* Base */}
        <div className="input">
          <h3>Base</h3>
          <label>Selecionar base</label>
          <select value={baseSel} onChange={e => setBaseSel(e.target.value)}>
            <option value="" disabled>Selecione...</option>
            {bases.map(b => <option key={b} value={b}>{b}</option>)}
          </select>

          <div className="row">
            <div>
              <label>Base - Latitude</label>
              <input type="number" step="0.000001" value={baseLat} onChange={e => setBaseLat(Number(e.target.value))} />
            </div>
            <div>
              <label>Base - Longitude</label>
              <input type="number" step="0.000001" value={baseLon} onChange={e => setBaseLon(Number(e.target.value))} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="secondary" onClick={autoCenterBase}>Centrar base pela média</button>
            <button onClick={useMyLocation} disabled={locating}>
              {locating ? 'Obtendo localização...' : 'Usar minha localização'}
            </button>
            {locError && <span className="small" style={{ color: '#f87171' }}>{locError} (HTTPS/localhost)</span>}
          </div>
        </div>

        <hr />

        {/* Filtros + Legenda */}
        <div className="input">
          <h3>Filtros</h3>
          <div className="row">
            <div>
              <label>Buscar por MF</label>
              <input type="text" placeholder="ex.: 2000829" value={searchId} onChange={e => setSearchId(e.target.value)} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={hideCompletedOnMap} onChange={e => setHideCompletedOnMap(e.target.checked)} />
              Ocultar concluídos no mapa
            </label>
          </div>
          {rowsByBase.length > 0 && (
            <div className="legend">
              <div className="legend-bar" style={{ background: legendGradient }} />
              <div className="legend-labels">
                <span>{lossDomain.min.toLocaleString('pt-BR')}</span>
                <span>Maior perda</span>
                <span>{lossDomain.max.toLocaleString('pt-BR')}</span>
              </div>
            </div>
          )}
        </div>

        <hr />

        {/* Rota e custos */}
        <div className="input">
          <h3>Rota e custos</h3>
          <label>Estratégia</label>
          <select value={strategy} onChange={e => setStrategy(e.target.value as SelectionStrategy)}>
            <option value="loss">Maiores perdas</option>
            <option value="proximity">Mais próximos (raio)</option>
          </select>

          {strategy === 'proximity' && (
            <div className="row">
              <div><label>Raio (km)</label><input type="number" step={0.1} min={0.1} value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))} /></div>
              <div><label>Quantidade desejada</label><input type="number" min={1} max={1000} value={topN} onChange={e => setTopN(Number(e.target.value))} /></div>
            </div>
          )}
          {strategy === 'loss' && (
            <div className="row">
              <div><label>Quantidade (Top-N)</label><input type="number" min={1} max={1000} value={topN} onChange={e => setTopN(Number(e.target.value))} /></div>
            </div>
          )}

          <label style={{ marginTop: 8 }}>Métrica de custo</label>
          <select value={distanceProvider} onChange={e => setDistanceProvider(e.target.value as DistanceProvider)}>
            <option value="haversine">Geodésica (km)</option>
            <option value="osrm">Ruas (km)</option>
            <option value="osrm-duration">Ruas (min) — recomendado</option>
          </select>
          <div className="small">Usado: {providerUsed === 'osrm-duration' ? 'OSRM Tempo (min)' : providerUsed === 'osrm' ? 'OSRM Distância (km)' : 'Haversine (km)'} — fallback automático</div>

          <label style={{ marginTop: 8 }}>Destino final</label>
          <select value={endMode} onChange={e => setEndMode(e.target.value as EndMode)}>
            <option value="return_base">Voltar à base</option>
            <option value="end_last">Terminar no último ponto</option>
            <option value="custom">Terminar em destino customizado (lat/lon)</option>
          </select>

          {endMode === 'custom' && (
            <div className="row">
              <div><label>Destino - Latitude</label><input type="number" step="0.000001" value={customDestLat} onChange={e => setCustomDestLat(e.target.value === '' ? '' : Number(e.target.value))} /></div>
              <div><label>Destino - Longitude</label><input type="number" step="0.000001" value={customDestLon} onChange={e => setCustomDestLon(e.target.value === '' ? '' : Number(e.target.value))} /></div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={generateRoute} disabled={!team && onlineEnabled}>Gerar rota</button>
            <button className="secondary" onClick={clearRoute}>Limpar</button>
            {onlineEnabled && !team && <div className="small" style={{ color: '#f59e0b' }}>Informe a Equipe para sincronizar concluídos.</div>}
          </div>
        </div>

        <hr />

        {/* Resumo */}
        <div className="input">
          <h3>Resumo</h3>
          <div className="row">
            <div className="badge">Selecionados: {selected.length}</div>
            {providerUsed === 'osrm-duration'
              ? <div className="badge">Tempo total: {totalMin.toFixed(1)} min</div>
              : <div className="badge">Distância total: {totalKm.toFixed(2)} km</div>
            }
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={exportCsv} disabled={!routeOrder.length}>Baixar CSV</button>
            {gmapsUrl && <a className="button" href={gmapsUrl} target="_blank" rel="noreferrer">Abrir no Google Maps</a>}
          </div>
        </div>

        {/* Cards de Selecionados */}
        <hr />
        <SelectedCards
          items={selected}
          isDone={(id) => getDone(completed, baseSel, id)}
          onToggleDone={(item) => toggleDoneUI(item)}
          onCenter={(item) => { setPanCoord([item.lat, item.lon]); setBurstId(item.id); window.setTimeout(() => setBurstId(null), 1300) }}
          orderNumbers={orderNumbers}
          pulseId={badgePulse?.id ?? null}
          pulseKind={badgePulse?.kind ?? null}
          chipStyleForLoss={chipStyleForLoss}
        />
      </div>

      {/* Painel do mapa */}
      <div className="panel">
        <h3>Mapa</h3>
        <div style={{ height: 'calc(100% - 30px)' }}>
          <MapContainer key={`${baseLat.toFixed(6)},${baseLon.toFixed(6)}`} center={[baseLat, baseLon]} zoom={12} style={{ height: '100%', width: '100%', background: 'var(--map-bg)' }}>
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <FlyTo center={panCoord ?? undefined} />

            {/* Base */}
            <CircleMarker center={[baseLat, baseLon]} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.9 }} radius={MARKER.base}>
              <Tooltip direction="top" offset={[0, -8]} opacity={1}>Base</Tooltip>
            </CircleMarker>

            {/* Trafos da base (cor por perda) */}
            {rowsByBase
              .filter(r => !(hideCompletedOnMap && getDone(completed, r.base, r.id)))
              .map((r) => {
                const done = getDone(completed, r.base, r.id)
                const { h, s, l } = lossHsl(r.perda)
                const stroke = done ? '#22c55e' : hslStr(h, s, Math.max(20, l - 12))
                const fill = done ? '#22c55e' : hslStr(h, s, l)
                const isHovered = hoveredId === r.id
                const radius = isHovered ? MARKER.all.hover : MARKER.all.normal
                return (
                  <CircleMarker
                    key={`all-${r.id}`}
                    center={[r.lat, r.lon]}
                    pathOptions={{ color: stroke, fillColor: fill, fillOpacity: 0.85 }}
                    radius={radius}
                    eventHandlers={{
                      click: () => onMarkerClick(r.id),
                      mouseover: () => setHoveredId(r.id),
                      mouseout: () => setHoveredId(null)
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                      <div>MF {r.id}<br />Perda: {r.perda.toLocaleString('pt-BR')}</div>
                    </Tooltip>
                  </CircleMarker>
                )
            })}

            {/* Selecionados (mesma paleta, realce no tamanho) */}
            {selected.map((s) => {
              const isHovered = hoveredId === s.id
              const rad = isHovered ? MARKER.selected.hover : MARKER.selected.normal
              const { h, l } = lossHsl(s.perda)
              const stroke = hslStr(h, 85, Math.max(18, l - 14))
              const fill = hslStr(h, 85, l)
              return (
                <CircleMarker
                  key={`sel-${s.id}`}
                  center={[s.lat, s.lon]}
                  pathOptions={{ color: stroke, fillColor: fill, fillOpacity: 0.95 }}
                  radius={rad}
                  eventHandlers={{ click: () => onMarkerClick(s.id), mouseover: () => setHoveredId(s.id), mouseout: () => setHoveredId(null) }}
                >
                  <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                    <div>Selecionado MF {s.id}<br />Perda: {s.perda.toLocaleString('pt-BR')}</div>
                  </Tooltip>
                </CircleMarker>
              )
            })}

            {/* Numeração por rota com efeitos */}
            {routeOrder.slice(1).map((idxInCoords, stepIdx) => {
              const idxInSelected = idxInCoords - 1
              const s = selected[idxInSelected]
              if (!s) return null
              const done = getDone(completed, s.base, s.id)
              const pulseClass = badgePulse?.id === s.id ? (badgePulse.kind === 'complete' ? ' pulse-complete' : ' pulse-undo') : ''
              const burstClass = burstId === s.id ? ' focus-burst' : ''
              const completedClass = done ? ' completed' : ''
              return (
                <CircleMarker key={`num-${s.id}`} center={[s.lat, s.lon]} radius={0}>
                  <Tooltip direction="right" offset={[10, 0]} opacity={1} permanent>
                    <div className={`map-badge${completedClass}${burstClass}${pulseClass}`}>{stepIdx + 1}</div>
                  </Tooltip>
                </CircleMarker>
              )
            })}

            {/* Rota */}
            {routeCoords.length >= 2 && <Polyline positions={routeCoords} pathOptions={{ color: 'var(--route-color)', weight: 4, opacity: 0.95 }} />}
          </MapContainer>
        </div>
      </div>
    </div>
  )
}