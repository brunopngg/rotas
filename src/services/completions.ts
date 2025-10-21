import { supabase, onlineEnabled } from '../lib/supabase'

export type CompletionRow = {
  id: string
  team: string
  base: string
  trafo_id: string
  done: boolean
  actor: string | null
  done_at: string
}

export async function listCompletions(team: string, base: string): Promise<Set<string>> {
  if (!onlineEnabled || !supabase) return new Set()
  const { data, error } = await supabase
    .from('completions')
    .select('trafo_id, done')
    .eq('team', team)
    .eq('base', base)

  if (error) {
    console.error('listCompletions error:', error)
    return new Set()
  }
  const rows = ((data as { trafo_id: string; done: boolean }[] | null) ?? [])
  return new Set(rows.filter(r => r.done).map(r => r.trafo_id))
}

export async function setCompletion(team: string, base: string, trafoId: string, done: boolean, actor?: string) {
  if (!onlineEnabled || !supabase) return
  const { error } = await supabase
    .from('completions')
    .upsert({ team, base, trafo_id: trafoId, done, actor: actor ?? null }, { onConflict: 'team,base,trafo_id' })
  if (error) console.error('setCompletion error:', error)
}

export function subscribeCompletions(team: string, base: string, onChange: (trafoId: string, done: boolean) => void) {
  if (!onlineEnabled || !supabase) return { unsubscribe() {} }

  const client = supabase!

  const channel = client.channel(`completions`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completions' }, (payload: any) => {
      const row = payload.new ?? payload.old
      if (!row) return
      if (row.team !== team || row.base !== base) return
      onChange(row.trafo_id, !!row.done)
    })
    .subscribe()

  return {
    unsubscribe() {
      client.removeChannel(channel)
    }
  }
}