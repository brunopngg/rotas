// Reimplemented completions storage using localStorage and in-page events.
// API kept compatible with existing usage: listCompletions, setCompletion, subscribeCompletions.

export type CompletionRow = {
  id: string
  team: string
  base: string
  trafo_id: string
  done: boolean
  actor: string | null
  done_at: string
}

const STORAGE_PREFIX = 'rota-trafos:completions' // key = `${STORAGE_PREFIX}:${team}:${base}`

function storageKey(team: string, base: string) {
  return `${STORAGE_PREFIX}:${team || '_'}:${base || '_'}`
}

function readRaw(team: string, base: string): Record<string, CompletionRow> {
  try {
    const key = storageKey(team, base)
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, CompletionRow>
  } catch (e) {
    console.error('readRaw completions error', e)
    return {}
  }
}

function writeRaw(team: string, base: string, map: Record<string, CompletionRow>) {
  try {
    const key = storageKey(team, base)
    localStorage.setItem(key, JSON.stringify(map))
  } catch (e) {
    console.error('writeRaw completions error', e)
  }
}

// Eventing: broadcast local changes so subscribers in the same page/app can react.
// Event detail: { team, base, trafoId, done, row }
const EVENT_NAME = 'rota-completions-changed'

export async function listCompletions(team: string, base: string): Promise<Set<string>> {
  // returns set of trafo_id marked as done
  const map = readRaw(team, base)
  const s = new Set<string>()
  for (const k in map) {
    if (map[k].done) s.add(map[k].trafo_id)
  }
  return s
}

export async function setCompletion(team: string, base: string, trafoId: string, done: boolean, actor?: string) {
  const map = readRaw(team, base)
  const now = new Date().toISOString()
  const row: CompletionRow = {
    id: `${team}:${base}:${trafoId}`,
    team,
    base,
    trafo_id: trafoId,
    done,
    actor: actor ?? null,
    done_at: now
  }
  map[trafoId] = row
  writeRaw(team, base, map)

  // broadcast
  try {
    const ev = new CustomEvent(EVENT_NAME, { detail: { team, base, trafoId, done, row } })
    window.dispatchEvent(ev)
  } catch (e) {
    // older browsers: fallback to console
    console.warn('dispatch event failed', e)
  }
}

export function subscribeCompletions(team: string, base: string, onChange: (trafoId: string, done: boolean) => void) {
  // returns an object with unsubscribe()
  const handler = (ev: Event) => {
    try {
      // CustomEvent carries detail
      const ce = ev as CustomEvent
      const d = ce.detail
      if (!d) return
      if (d.team !== team || d.base !== base) return
      onChange(d.trafoId, !!d.done)
    } catch (e) {
      console.error('subscribeCompletions handler error', e)
    }
  }
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return {
    unsubscribe() {
      window.removeEventListener(EVENT_NAME, handler as EventListener)
    }
  }
}