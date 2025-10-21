import { Trafo } from '../types'

type Props = {
  trafos: Trafo[]
  base: string
  completed: Record<string, Record<string, boolean>>
  onToggleDone: (t: Trafo) => void
}

export default function TrafosList({ trafos, base, completed, onToggleDone }: Props) {
  return (
    <div className="input">
      <h3>Trafos com maiores perdas</h3>
      <div className="trafos-list">
        {trafos.length === 0 && <div className="small">Nenhum trafo na base selecionada.</div>}
        {trafos.slice(0, 100).map(t => {
          const done = !!completed[t.base]?.[t.id]
          return (
            <div key={`${t.base}-${t.id}`} className={`trafos-item ${done ? 'done' : ''}`}>
              <input type="checkbox" checked={done} onChange={() => onToggleDone(t)} title="Marcar como concluído" />
              <div>
                <div><b>{t.id}</b> — Perda: {t.perda}</div>
                <div className="small">{t.lat}, {t.lon}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="badge">{t.base || base}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="small">Exibindo até 100 (ordenado por perda desc.).</div>
    </div>
  )
}