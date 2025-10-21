export type DistanceProvider = 'haversine' | 'osrm' | 'osrm-duration'
// 'osrm' = distância por vias; 'osrm-duration' = tempo por vias (min)

const OSRM_BASE = 'https://router.project-osrm.org'
const OSRM_TABLE_MAX = 100 // limite prático no demo

export const EARTH_RADIUS_KM = 6371.0088

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const rlat1 = toRad(lat1), rlon1 = toRad(lon1), rlat2 = toRad(lat2), rlon2 = toRad(lon2)
  const dlat = rlat2 - rlat1
  const dlon = rlon2 - rlon1
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2
  const c = 2 * Math.asin(Math.sqrt(a))
  return EARTH_RADIUS_KM * c
}

export function buildDistanceMatrixHaversine(coords: [number, number][]): number[][] {
  const n = coords.length
  const dm: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(coords[i][0], coords[i][1], coords[j][0], coords[j][1])
      dm[i][j] = d
      dm[j][i] = d
    }
  }
  return dm
}

async function buildOsrmTable(coords: [number, number][], annotation: 'distance' | 'duration'): Promise<number[][]> {
  if (coords.length > OSRM_TABLE_MAX) throw new Error(`Excede limite da OSRM Table demo (${OSRM_TABLE_MAX})`)
  const coordStr = coords.map(([lat, lon]) => `${lon},${lat}`).join(';')
  const url = `${OSRM_BASE}/table/v1/driving/${coordStr}?annotations=${annotation}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OSRM table falhou: ${res.status}`)
  const json = await res.json()
  const matrix = json?.[annotation === 'distance' ? 'distances' : 'durations']
  if (!Array.isArray(matrix)) throw new Error('Resposta OSRM sem matriz')
  // distance: metros -> km; duration: segundos -> minutos
  if (annotation === 'distance') {
    return matrix.map((row: number[]) => row.map(v => (typeof v === 'number' ? v / 1000 : Infinity)))
  } else {
    return matrix.map((row: number[]) => row.map(v => (typeof v === 'number' ? v / 60 : Infinity)))
  }
}

export async function buildDistanceMatrix(
  provider: DistanceProvider,
  coords: [number, number][],
): Promise<{ dm: number[][], providerUsed: DistanceProvider }> {
  try {
    if (provider === 'osrm') {
      const dm = await buildOsrmTable(coords, 'distance')
      return { dm, providerUsed: 'osrm' }
    }
    if (provider === 'osrm-duration') {
      const dm = await buildOsrmTable(coords, 'duration')
      return { dm, providerUsed: 'osrm-duration' }
    }
    const dm = buildDistanceMatrixHaversine(coords)
    return { dm, providerUsed: 'haversine' }
  } catch {
    // fallback para haversine
    const dm = buildDistanceMatrixHaversine(coords)
    return { dm, providerUsed: 'haversine' }
  }
}

export function nearestNeighbor(dm: number[][], start = 0): number[] {
  const n = dm.length
  const unvisited = new Set<number>(Array.from({ length: n }, (_, i) => i))
  const route: number[] = [start]
  unvisited.delete(start)
  let current = start
  while (unvisited.size) {
    let best = -1
    let bestDist = Infinity
    for (const j of unvisited) {
      const d = dm[current][j]
      if (d < bestDist) {
        bestDist = d
        best = j
      }
    }
    route.push(best)
    unvisited.delete(best)
    current = best
  }
  return route
}

export function routeLength(route: number[], dm: number[][], returnToStart = false): number {
  let total = 0
  for (let i = 0; i < route.length - 1; i++) total += dm[route[i]][route[i + 1]]
  if (returnToStart && route.length > 1) total += dm[route[route.length - 1]][route[0]]
  return total
}

export function twoOpt(route: number[], dm: number[][], returnToStart = false, maxIter = 200): number[] {
  let best = route.slice()
  let bestLen = routeLength(best, dm, returnToStart)
  let improved = true
  let it = 0
  while (improved && it < maxIter) {
    improved = false
    it++
    for (let i = 1; i < best.length - 2; i++) {
      for (let k = i + 1; k < best.length; k++) {
        if (k - i === 1) continue
        const newRoute = best.slice(0, i).concat(best.slice(i, k).reverse(), best.slice(k))
        const newLen = routeLength(newRoute, dm, returnToStart)
        if (newLen + 1e-9 < bestLen) {
          best = newRoute
          bestLen = newLen
          improved = true
        }
      }
    }
  }
  return best
}

// 2.5-opt (Or-Opt 1-remoção/1-inserção simples)
export function twoPointFiveOpt(route: number[], dm: number[][], returnToStart = false, maxIter = 200): number[] {
  let best = route.slice()
  let bestLen = routeLength(best, dm, returnToStart)
  let improved = true
  let it = 0
  while (improved && it < maxIter) {
    improved = false
    it++
    for (let i = 1; i < best.length - 1; i++) {
      const node = best[i]
      const candidate = best.slice(0, i).concat(best.slice(i + 1))
      for (let j = 1; j < candidate.length; j++) {
        const newRoute = candidate.slice(0, j).concat([node], candidate.slice(j))
        const newLen = routeLength(newRoute, dm, returnToStart)
        if (newLen + 1e-9 < bestLen) {
          best = newRoute
          bestLen = newLen
          improved = true
        }
      }
    }
  }
  return best
}

export async function fetchOsrmRouteGeoJSON(coordsOrdered: [number, number][]): Promise<[number, number][] | null> {
  if (coordsOrdered.length < 2) return null
  const coordStr = coordsOrdered.map(([lat, lon]) => `${lon},${lat}`).join(';')
  const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = await res.json()
  const line = json?.routes?.[0]?.geometry?.coordinates
  if (!Array.isArray(line)) return null
  return line.map((c: [number, number]) => [c[1], c[0]])
}