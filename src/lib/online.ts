// online quando temos backend configurado
export const API_BASE = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_API_BASE) ||
  (typeof process !== 'undefined' && (process as any).env && (process as any).env.VITE_API_BASE)
) as string | undefined
export const onlineEnabled = !!API_BASE