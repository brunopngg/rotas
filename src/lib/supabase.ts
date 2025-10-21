/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITESUPABASEURL as string | undefined
const anon = import.meta.env.VITESUPABASEANON as string | undefined

export const onlineEnabled = !!(url && anon)
export const supabase = onlineEnabled ? createClient(url!, anon!) : null