import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip } from 'react-leaflet'
import { Trafo } from '../types'

type Props = {
  baseCoord: [number, number]
  trafos: Trafo[]
  selected: Trafo[]
  routeCoords: [number, number][]
}

export default function MapView({ baseCoord, trafos, selected, routeCoords }: Props) {
  const [baseLat, baseLon] = baseCoord
  const center = routeCoords[0] || [baseLat, baseLon]

  return (
    <MapContainer center={center as [number, number]} zoom={12} style={{ height: '100%', width: '100%' }}>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {/* Base */}
      <CircleMarker center={[baseLat, baseLon]} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.9 }} radius={7}>
        <Tooltip direction="top" offset={[0, -8]} opacity={1}>Base</Tooltip>
      </CircleMarker>

      {/* Todos os trafos da base (cinza) */}
      {trafos.map((r) => (
        <CircleMarker key={`all-${r.id}`} center={[r.lat, r.lon]} pathOptions={{ color: '#999', fillColor: '#ccc', fillOpacity: 0.7 }} radius={5}>
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            <div>Trafo {r.id}<br />Perda: {r.perda}</div>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Selecionados (azul) */}
      {selected.map((s) => (
        <CircleMarker key={`sel-${s.id}`} center={[s.lat, s.lon]} pathOptions={{ color: '#1f77b4', fillColor: '#1f77b4', fillOpacity: 0.9 }} radius={6}>
          <Tooltip direction="top" offset={[0, -8]} opacity={1}>
            <div>Selecionado {s.id}<br />Perda: {s.perda}</div>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Rota (vermelho) */}
      {routeCoords.length >= 2 && (
        <Polyline positions={routeCoords} pathOptions={{ color: 'red', weight: 4, opacity: 0.9 }} />
      )}
    </MapContainer>
  )
}