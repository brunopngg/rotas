export type Trafo = {
  id: string
  base: string
  perda: number
  lat: number
  lon: number
}

export type SelectionStrategy = 'loss' | 'proximity'

export type RouteData = {
  orderIndices: number[]        // índices dentro do array de trafos selecionados
  coords: [number, number][]    // sequência de coordenadas (incluindo base no início e opcionalmente no fim)
  totalKm: number
}