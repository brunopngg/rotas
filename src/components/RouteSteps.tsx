import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { DistanceProvider } from '../utils/routing'

type Props = {
  routeOrder: number[]                      // índices em coordsWithBase (inclui 0 = BASE)
  coordsWithBase: [number, number][]        // [BASE, ...selecionados]
  labelsWithBase: string[]                  // ['BASE', ...ids]
  perdasWithBase: (number | '')[]           // ['', ...perdas]
  dmUsed: number[][] | null
  providerUsed: DistanceProvider
  returnToStart: boolean

  // status concluído
  isDone: (id: string) => boolean
  onToggleDone: (id: string) => void

  // Integração/ações
  currentStep: number | null                // 1..N (sem contar a BASE)
  focusId?: string | null                   // quando mudar, faz scroll até a linha com esse ID
  onHover: (id: string | null) => void
  onNavigate: (lat: number, lon: number, provider: 'google' | 'waze') => void

  // Reordenar (entrega nova ordem de selected: 0..N-1)
  onReorder: (newSelectedOrder: number[]) => void
}

// Haversine local (fallback para exibir se não houver dmUsed)
const EARTH_RADIUS_KM = 6371.0088
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const rlat1 = toRad(lat1), rlon1 = toRad(lon1), rlat2 = toRad(lat2), rlon2 = toRad(lon2)
  const dlat = rlat2 - rlat1
  const dlon = rlon2 - rlon1
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2
  const c = 2 * Math.asin(Math.sqrt(a))
  return EARTH_RADIUS_KM * c
}

export default function RouteSteps(props: Props) {
  const {
    routeOrder, coordsWithBase, labelsWithBase, perdasWithBase, dmUsed, providerUsed, returnToStart,
    isDone, onToggleDone, currentStep, focusId, onHover, onNavigate, onReorder
  } = props

  const isDuration = providerUsed === 'osrm-duration'

  const steps = useMemo(() => {
    if (!routeOrder.length) return []
    const out: {
      idxInOrder: number
      selectedIdx: number
      id: string
      perda: number | ''
      lat: number
      lon: number
      trecho: number     // km ou min
      acumulado: number  // km ou min
    }[] = []
    let cumul = 0
    for (let i = 1; i < routeOrder.length; i++) {
      const idx = routeOrder[i]
      const [lat, lon] = coordsWithBase[idx]
      const id = labelsWithBase[idx]
      const perda = perdasWithBase[idx]
      const prev = routeOrder[i - 1]
      let cost = 0
      if (dmUsed) {
        cost = dmUsed[prev][idx]
      } else {
        // fallback: exibe km por haversine
        cost = haversineKm(coordsWithBase[prev][0], coordsWithBase[prev][1], lat, lon)
      }
      cumul += cost
      out.push({
        idxInOrder: i,
        selectedIdx: idx - 1,
        id, perda, lat, lon,
        trecho: cost,
        acumulado: cumul,
      })
    }
    return out
  }, [routeOrder, coordsWithBase, labelsWithBase, perdasWithBase, dmUsed])

  const returnRow = useMemo(() => {
    if (!returnToStart || routeOrder.length < 2) return null
    const last = routeOrder[routeOrder.length - 1]
    const first = routeOrder[0]
    let back = 0
    if (dmUsed) back = dmUsed[last][first]
    else back = haversineKm(
      coordsWithBase[last][0], coordsWithBase[last][1],
      coordsWithBase[first][0], coordsWithBase[first][1]
    )
    const cumul = steps.length ? steps[steps.length - 1].acumulado + back : back
    return {
      ordem: (steps.length + 1),
      id: 'BASE (retorno)',
      perda: '',
      lat: coordsWithBase[first][0],
      lon: coordsWithBase[first][1],
      trecho: back,
      acumulado: cumul,
    }
  }, [returnToStart, routeOrder, coordsWithBase, dmUsed, steps])

  const [dragOrder, setDragOrder] = useState<number[]>([])
  const dragFrom = useRef<number | null>(null)
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({})

  useEffect(() => {
    const selOrder = routeOrder.slice(1).map(idx => idx - 1)
    setDragOrder(selOrder)
  }, [routeOrder])

  useEffect(() => {
    if (!focusId) return
    const el = rowRefs.current[focusId]
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusId])

  function onDragStart(e: React.DragEvent<HTMLTableRowElement>, idx: number) {
    dragFrom.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  function onDragOver(e: React.DragEvent<HTMLTableRowElement>) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  function onDrop(e: React.DragEvent<HTMLTableRowElement>, toIdx: number) {
    e.preventDefault()
    const fromIdx = dragFrom.current
    dragFrom.current = null
    if (fromIdx === null || fromIdx === toIdx) return
    const next = dragOrder.slice()
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setDragOrder(next)
    onReorder(next)
  }

  function rowClass(id: string, ordem: number) {
    const isActive = props.currentStep === ordem
    return 'steps-row' + (isActive ? ' active' : '')
  }

  return (
    <div className="steps">
      <h3>Rota (passo a passo)</h3>
      <table className="steps-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th>#</th>
            <th>ID</th>
            <th>Perda</th>
            <th>{isDuration ? 'Trecho (min)' : 'Trecho (km)'}</th>
            <th>{isDuration ? 'Acumulado (min)' : 'Acumulado (km)'}</th>
            <th style={{ width: 200 }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, visualIdx) => {
            const ordemExibida = visualIdx + 1
            const perdaNum = s.perda === '' ? '' : Number(s.perda)
            const done = isDone(s.id)
            return (
              <tr
                key={s.id}
                ref={el => { rowRefs.current[s.id] = el }}
                className={rowClass(s.id, ordemExibida)}
                draggable
                onDragStart={(e) => onDragStart(e, visualIdx)}
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, visualIdx)}
                onMouseEnter={() => onHover(s.id)}
                onMouseLeave={() => onHover(null)}
              >
                <td className="drag-handle" title="Arraste para reordenar">≡</td>
                <td>{ordemExibida}</td>
                <td>{s.id}</td>
                <td>{perdaNum === '' ? '' : perdaNum.toLocaleString('pt-BR')}</td>
                <td>{s.trecho.toFixed(2)}</td>
                <td>{s.acumulado.toFixed(2)}</td>
                <td>
                  <div className="row-actions">
                    <button className="ghost" onClick={() => onNavigate(s.lat, s.lon, 'google')}>Maps</button>
                    <button className="ghost" onClick={() => onNavigate(s.lat, s.lon, 'waze')}>Waze</button>
                    <button className={done ? 'ghost' : 'secondary'} onClick={() => onToggleDone(s.id)}>
                      {done ? 'Desfazer' : 'Concluir'}
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {returnRow && (
            <tr className="steps-row return">
              <td></td>
              <td>{returnRow.ordem}</td>
              <td>{returnRow.id}</td>
              <td></td>
              <td>{returnRow.trecho.toFixed(2)}</td>
              <td>{returnRow.acumulado.toFixed(2)}</td>
              <td className="small">Retorno automático</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="small">Dica: arraste as linhas para ajustar a ordem da rota. Os valores serão recalculados.</div>
    </div>
  )
}