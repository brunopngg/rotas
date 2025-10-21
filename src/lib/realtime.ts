import { io, Socket } from 'socket.io-client'
import { API_BASE } from './online'

let socket: Socket | null = null

export function getSocket(): Socket | null {
  if (!API_BASE) return null
  if (socket && socket.connected) return socket
  socket = io(API_BASE, { transports: ['websocket'], autoConnect: true })
  return socket
}

export function joinRoom(team: string, base: string) {
  const s = getSocket()
  if (!s) return
  s.emit('join', { team, base })
}

export function onCompletionUpdate(handler: (p: { team: string; base: string; trafoId: string; done: boolean; actor?: string; at: string }) => void) {
  const s = getSocket()
  if (!s) return () => {}
  const fn = (payload: any) => handler(payload)
  s.on('completion:update', fn)
  return () => s.off('completion:update', fn)
}