import type { AuthUser, Env, Role } from '../types'
import { verifyJwt } from './crypto'

export function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || ''
  const allowed = (env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
  const matchingOrigin = allowed.find(value => value.toLowerCase() === origin.toLowerCase())
  const allowOrigin = matchingOrigin ? origin : allowed[0] || '*'
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

export async function requireAuth(request: Request, env: Env, roles: Role[] = ['admin', 'manager', 'categorizer', 'viewer']) {
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const payload = token ? await verifyJwt(token, env.JWT_SECRET || 'change-this-secret-before-production') : null
  if (!payload || !roles.includes(payload.role as Role)) throw new HttpError('Sessão administrativa inválida ou expirada.', 401)
  const admin = await env.DB.prepare('SELECT id, username, role, is_active FROM admins WHERE id = ?').bind(payload.sub).first<{ id: number; username: string; role: Role; is_active: number }>()
  if (!admin || !admin.is_active || admin.role !== payload.role) throw new HttpError('Usuário administrativo inativo ou alterado.', 401)
  const scopes = await env.DB.prepare('SELECT library_id, all_libraries FROM admin_library_access WHERE admin_id = ?').bind(admin.id).all<{ library_id: string | null; all_libraries: number }>()
  return { id: admin.id, username: admin.username, role: admin.role, allLibraries: (scopes.results || []).some(scope => scope.all_libraries === 1), libraryIds: (scopes.results || []).map(scope => scope.library_id).filter((value): value is string => Boolean(value)) } satisfies AuthUser
}
