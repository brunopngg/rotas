import React from 'react'

export type Trafo = {
  id: string
  base: string
  perda: number
  lat: number
  lon: number
}

type Props = {
  items: Trafo[]
  isDone: (id: string) => boolean
  onToggleDone: (item: Trafo) => void
  onCenter?: (item: Trafo) => void
  orderNumbers?: Record<string, number>
  // Efeito de pulso no badge do número quando concluir/desfazer
  pulseId?: string | null
  pulseKind?: 'complete' | 'undo' | null
  // Estilo do chip de perda baseado na paleta dinâmica
  chipStyleForLoss: (perda: number) => React.CSSProperties
}

export default function SelectedCards({
  items,
  isDone,
  onToggleDone,
  onCenter,
  orderNumbers = {},
  pulseId = null,
  pulseKind = null,
  chipStyleForLoss,
}: Props) {
  if (!items.length) return null

  return (
    <div className="selected-section">
      <h3>Selecionados</h3>
      <div className="cards-grid">
        {items.map((t) => {
          const done = isDone(t.id)
          const order = orderNumbers[t.id]
          const badgeClasses = [
            'badge',
            'badge-order',
            done ? 'completed' : '',
            pulseId === t.id ? (pulseKind === 'complete' ? 'pulse-complete' : pulseKind === 'undo' ? 'pulse-undo' : '') : '',
          ].join(' ').trim()

          return (
            <div key={t.id} className={`card minimal ${done ? 'card-done' : ''}`}>
              <div className="card-header">
                <div className="card-title">
                  <span className="mono">MF</span> <b>{t.id}</b>
                </div>
                {order ? (
                  <span className={badgeClasses} title="Ordem na rota">
                    #{order}
                  </span>
                ) : null}
              </div>

              {/* Linha compacta de info — perda colorida + coords sutis */}
              <div className="card-info-row">
                <span className="chip" style={chipStyleForLoss(t.perda)} title="Perda">
                  <span className="chip-label">Perda</span>
                  <span className="chip-value">{t.perda.toLocaleString('pt-BR')}</span>
                </span>
                <span className="muted small">
                  {t.lat}, {t.lon}
                </span>
              </div>

              <div className="card-actions">
                <button
                  className={done ? 'ghost' : 'secondary'}
                  onClick={() => onToggleDone(t)}
                  title={done ? 'Desfazer concluído' : 'Marcar como concluído'}
                >
                  {done ? 'Desfazer' : 'Concluir'}
                </button>
                {onCenter && (
                  <button className="ghost" onClick={() => onCenter(t)} title="Focar no mapa">
                    Focar no mapa
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}