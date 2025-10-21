type Props = {
  bases: string[]
  base: string
  onChangeBase: (b: string) => void
  baseLat: number
  baseLon: number
  onChangeBaseLat: (v: number) => void
  onChangeBaseLon: (v: number) => void
  returnToBase: boolean
  onChangeReturnToBase: (v: boolean) => void
}

export default function BaseSelector({
  bases, base, onChangeBase,
  baseLat, baseLon, onChangeBaseLat, onChangeBaseLon,
  returnToBase, onChangeReturnToBase
}: Props) {
  return (
    <div className="input">
      <h3>Base</h3>
      <label>Selecionar base</label>
      <select value={base} onChange={e => onChangeBase(e.target.value)}>
        <option value="" disabled>Selecione...</option>
        {bases.map(b => <option key={b} value={b}>{b}</option>)}
      </select>

      <div className="row">
        <div>
          <label>Base - Latitude</label>
          <input type="number" step="0.000001" value={baseLat} onChange={e => onChangeBaseLat(Number(e.target.value))} />
        </div>
        <div>
          <label>Base - Longitude</label>
          <input type="number" step="0.000001" value={baseLon} onChange={e => onChangeBaseLon(Number(e.target.value))} />
        </div>
      </div>

      <label>
        <input type="checkbox" checked={returnToBase} onChange={e => onChangeReturnToBase(e.target.checked)} />
        Voltar à base ao final
      </label>
    </div>
  )
}