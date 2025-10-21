export type Trafo = {
  id: string
  base: string
  perda: number
  lat: number
  lon: number
}

const HEADER_MAP: Record<string, 'id' | 'base' | 'perda' | 'lat' | 'lon'> = {
  // seus cabeçalhos
  'BASE': 'base',
  'MFINSTALLA': 'id',
  'PERDA': 'perda',
  'LATI': 'lat',
  'LONG': 'lon',
  // sinônimos comuns
  'MEDIDOR FISCAL (TRAFO)': 'id',
  'MEDIDOR FISCAL': 'id',
  'TRAFO': 'id',
  'MF': 'id',
  'CIDADE': 'base',
  'REGIAO': 'base',
  'REGIÃO': 'base',
  'LAT': 'lat',
  'LATITUDE': 'lat',
  'LON': 'lon',
  'LNG': 'lon',
  'LONGITUDE': 'lon',
  'PERDAS': 'perda',
  'LOSS': 'perda',
}

function cleanHeader(h: string) {
  return String(h || '')
    .replace(/^\uFEFF/, '') // remove BOM
    .trim()
    .toUpperCase()
}

function toNumBR(v: any): number {
  // troca vírgula decimal por ponto; remove espaços
  const s = String(v ?? '').trim().replace(/\s+/g, '')
  if (!s) return NaN
  // se houver milhar com ponto (1.234,56), remove pontos e troca vírgula por ponto
  return Number(s.replace(/\./g, '').replace(',', '.'))
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter(l => l.trim().length > 0)
}

export function parseCsvFlexible(text: string, delimiter = ';'): Trafo[] {
  const lines = splitLines(text)
  if (lines.length < 2) return []

  // encontra a primeira linha que parece ser cabeçalho (contém delimiter e as chaves esperadas)
  let headerIdx = 0
  while (headerIdx < lines.length && lines[headerIdx].split(delimiter).length < 3) headerIdx++
  if (headerIdx >= lines.length) return []

  const headerRaw = lines[headerIdx]
  const headerCols = headerRaw.split(delimiter).map(cleanHeader)

  const mapped: ('id' | 'base' | 'perda' | 'lat' | 'lon' | undefined)[] =
    headerCols.map(h => HEADER_MAP[h])

  const out: Trafo[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = lines[i]
    // ignora linhas que não tenham o mesmo número de colunas
    const parts = row.split(delimiter)
    if (parts.length < headerCols.length) continue

    const rec: Record<'id' | 'base' | 'perda' | 'lat' | 'lon', any> = {
      id: '',
      base: '',
      perda: NaN,
      lat: NaN,
      lon: NaN,
    }

    parts.forEach((val, idx) => {
      const key = mapped[idx]
      if (!key) return
      if (key === 'perda' || key === 'lat' || key === 'lon') {
        rec[key] = toNumBR(val)
      } else {
        rec[key] = String(val ?? '').trim()
      }
    })

    if (!rec.id || !rec.base) continue
    if ([rec.perda, rec.lat, rec.lon].some(n => Number.isNaN(n))) continue
    if (rec.lat < -90 || rec.lat > 90) continue
    if (rec.lon < -180 || rec.lon > 180) continue

    out.push({
      id: rec.id,
      base: rec.base,
      perda: rec.perda,
      lat: rec.lat,
      lon: rec.lon,
    })
  }
  return out
}

function looksMojibake(s: string) {
  // detecta caractere de substituição ou padrões comuns de mojibake
  return s.includes('\uFFFD') || s.includes('�') || /Ã.|Â./.test(s)
}

export async function loadCsvFromPublic(path: string, delimiter = ';'): Promise<Trafo[]> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Falha ao carregar ${path}: ${res.status} ${res.statusText}`)

  // tenta UTF-8 primeiro
  const buf = await res.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)

  // fallback para Windows-1252 se parecer corrompido
  if (looksMojibake(text)) {
    try {
      text = new TextDecoder('windows-1252').decode(buf)
    } catch {
      // se o ambiente não suportar, mantém UTF-8 mesmo
    }
  }

  return parseCsvFlexible(text, delimiter)
}