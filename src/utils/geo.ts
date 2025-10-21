// Estrutura de utilitários de geografia/rota (implementações futuras)

export const EARTH_RADIUS_KM = 6371.0088

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // TODO: implementar
  return 0
}

export function buildDistanceMatrix(coords: [number, number][]): number[][] {
  // TODO: implementar
  return []
}

export function nearestNeighbor(dm: number[][], start = 0): number[] {
  // TODO: implementar
  return []
}

export function twoOpt(route: number[], dm: number[][], returnToStart = false, maxIter = 200): number[] {
  // TODO: implementar
  return route
}

export function dbscanIndices(points: [number, number][], epsKm: number, minPts: number): number[] | null {
  // TODO: implementar
  return null
}