// Estrutura para persistência de "concluído" (implementações futuras via localStorage)

export type CompletedMap = Record<string, Record<string, boolean>> // base -> trafoId -> done

export function loadCompleted(): CompletedMap {
  // TODO: implementar
  return {}
}

export function saveCompleted(map: CompletedMap) {
  // TODO: implementar
}

export function getDone(map: CompletedMap, base: string, id: string): boolean {
  return !!map[base]?.[id]
}

export function setDone(map: CompletedMap, base: string, id: string, val: boolean): CompletedMap {
  const next: CompletedMap = { ...map }
  if (!next[base]) next[base] = {}
  if (val) next[base][id] = true
  else delete next[base][id]
  return next
}