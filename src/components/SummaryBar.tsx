type Props = {
  selectedCount: number
  totalKm: number
}

export default function SummaryBar({ selectedCount, totalKm }: Props) {
  return (
    <div className="input">
      <h3>Resumo</h3>
      <div className="row">
        <div className="badge">Trafos selecionados: {selectedCount}</div>
        <div className="badge">Distância total: {totalKm.toFixed(2)} km</div>
      </div>
      {/* TODO: botões de exportação (CSV/Google Maps) */}
    </div>
  )
}