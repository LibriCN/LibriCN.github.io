import type { Env } from './types'
import { corsHeaders, HttpError, json, empty, requireAuth } from './lib/http'
import { loginRoute, adminRoute } from './routes/admin'
import { publicRoute } from './routes/public'

function isCacheablePublicGet(request: Request, url: URL) {
  return request.method === 'GET' && /^\/api\/(?:health|books(?:\/|$)|libraries(?:\/|$))/.test(url.pathname)
}

const edgeCache = (caches as CacheStorage & { default: Cache }).default

async function dispatch(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true, city: env.CITY_NAME || 'Sua cidade', service: 'livro-perto-api' }, 200, request, env)
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return loginRoute(request, env)
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return empty(204, request, env)
    const publicResponse = await publicRoute(request, env, url.pathname, url)
    if (publicResponse) return publicResponse
    if (url.pathname.startsWith('/api/admin/')) {
      await requireAuth(request, env, ['admin', 'editor'])
      const adminResponse = await adminRoute(request, env, url.pathname.slice('/api/admin'.length), url)
      if (adminResponse) return adminResponse
    }
    return json({ error: 'Rota não encontrada.' }, 404, request, env)
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status, request, env)
    console.error(error)
    return json({ error: 'Não foi possível concluir a operação agora.' }, 500, request, env)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    const cacheKey = isCacheablePublicGet(request, url) ? new Request(request.url, { method: 'GET' }) : null
    if (cacheKey) {
      const cached = await edgeCache.match(cacheKey)
      if (cached) return cached
    }
    const response = await dispatch(request, env, url)
    if (cacheKey && response.ok) ctx.waitUntil(edgeCache.put(cacheKey, response.clone()))
    return response
  },
}
