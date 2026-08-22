import type { Env, Role } from '../types'
import { verifyJwt } from './crypto'

export function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || '*'
  return { 'Access-Control-Allow-Origin': allowOrigin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
}

export function json(data: unknown, status = 200, request?: Request, env?: Env) {
  const path = request ? new URL(request.url).pathname : ''
  const cacheablePublicGet = request?.method === 'GET' && status === 200 && /^\/api\/(?:health|books(?:\/|$)|libraries(?:\/|$))/.test(path)
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheablePublicGet ? 'public, max-age=30, stale-while-revalidate=120' : 'no-store',
  })
  if (request && env) Object.entries(corsHeaders(request, env)).forEach(([key, value]) => headers.set(key, value))
  return new Response(JSON.stringify(data), { status, headers })
}

export function empty(status: number, request: Request, env: Env) { return new Response(null, { status, headers: corsHeaders(request, env) }) }

export async function body<T>(request: Request): Promise<T> {
  try { return await request.json() as T } catch { throw new HttpError('Envie um JSON válido.', 400) }
}

export function text(value: unknown, max = 2000) { return String(value ?? '').trim().slice(0, max) }
export function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}` }
export function now() { return new Date().toISOString() }

export class HttpError extends Error { constructor(message: string, public status = 400) { super(message) } }

export async function requireAuth(request: Request, env: Env, roles: Role[] = ['admin', 'editor', 'viewer']) {
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const payload = token ? await verifyJwt(token, env.JWT_SECRET || 'change-this-secret-before-production') : null
  if (!payload || !roles.includes(payload.role as Role)) throw new HttpError('Sessão administrativa inválida ou expirada.', 401)
  return payload
}
