import { SelectionStrategy } from '../types'

type Props = {
  strategy: SelectionStrategy
  onChangeStrategy: (s: SelectionStrategy) => void
  topN: number
  onChangeTopN: (v: number) => void
  perdaMin: number
  onChangePerdaMin: (v: number) => void
  epsKm: number
  onChangeEpsKm: (v: number) => void
  minSamples: number
  onChangeMinSamples: (v: number) => void
  onGenerate: () => void
  onClear: () => void
}

export default function RouteControls(props: Props) {
  const {
    strategy, onChangeStrategy,
    topN, onChangeTopN,
    perdaMin, onChangePerdaMin,
    epsKm, onChangeEpsKm,
    minSamples, onChangeMinSamples,
    onGenerate, onClear
  } = props

  return (
    <div className="input">
      <h3>Gerar rota</h3>

      <label>Estratégia</label>
      <select value={strategy} onChange={e => onChangeStrategy(e.target.value as SelectionStrategy)}>
        <option value="loss">Maiores perdas</option>
        <option value="proximity">Mais próximos (cluster)</option>
      </select>

      {strategy === 'loss' ? (
        <>
          <div className="row">
            <div>
              <label>Quantidade (Top-N)</label>
              <input type="number" min={1} max={1000} value={topN} onChange={e => onChangeTopN(Number(e.target.value))} />
            </div>
            <div>
              <label>Perda mínima (filtro)</label>
              <input type="number" step="0.1" value={perdaMin} onChange={e => onChangePerdaMin(Number(e.target.value))} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <div>
              <label>Raio (km)</label>
              <input type="number" step="0.1" min={0.1} value={epsKm} onChange={e => onChangeEpsKm(Number(e.target.value))} />
            </div>
            <div>
              <label>Mínimo no cluster</label>
              <input type="number" min={2} value={minSamples} onChange={e => onChangeMinSamples(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <label>Quantidade desejada</label>
            <input type="number" min={1} max={1000} value={topN} onChange={e => onChangeTopN(Number(e.target.value))} />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onGenerate}>Gerar rota</button>
        <button onClick={onClear}>Limpar</button>
      </div>
    </div>
  )
}