import { API_BASE } from './online'

if (!API_BASE) {
  console.warn('[API] VITE_API_BASE ausente — modo offline/localStorage')
}

export async function apiGet<T>(path: string, params?: Record<string, string | number | boolean>) {
  if (!API_BASE) throw new Error('API_BASE missing')
  const url = new URL(path, API_BASE)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), { credentials: 'omit' })
  if (!res.ok) throw new Error(`GET ${url} ${res.status}`)
  return res.json() as Promise<T>
}

export async function apiPut<T>(path: string, body: any) {
  if (!API_BASE) throw new Error('API_BASE missing')
  const url = new URL(path, API_BASE)
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit'
  })
  if (!res.ok) throw new Error(`PUT ${url} ${res.status}`)
  return res.json() as Promise<T>
}