const PBKDF2_ITERATIONS = 100_000
const HASH_BYTES = 32

export async function hashPassword(password: string) {
  if (password.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derive(password, salt)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`
}

function toBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function derive(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' }, key, HASH_BYTES * 8)
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterationsRaw, saltRaw, expected] = stored.split('$')
  if (algorithm !== 'pbkdf2' || !iterationsRaw || !saltRaw || !expected) return false
  const iterations = Number(iterationsRaw)
  if (!Number.isInteger(iterations) || iterations < 10_000) return false
  const actual = toBase64(await derive(password, fromBase64(saltRaw), iterations))
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference === 0
}

function encode(value: string | Uint8Array) {
  return toBase64(typeof value === 'string' ? new TextEncoder().encode(value) : value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return new TextDecoder().decode(fromBase64(normalized + '='.repeat((4 - normalized.length % 4) % 4)))
}

export interface JwtPayload { sub: number; username: string; role: string; iat: number; exp: number }

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlDays: number) {
  const now = Math.floor(Date.now() / 1000)
  const full = { ...payload, iat: now, exp: now + Math.max(1, ttlDays) * 86_400 }
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = encode(JSON.stringify(full))
  const input = `${header}.${body}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))
  return { token: `${input}.${encode(new Uint8Array(signature))}`, expiresAt: full.exp }
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(decode(parts[1])) as JwtPayload
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000) || !payload.sub || !payload.username) return null
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = fromBase64(parts[2].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[2].length % 4) % 4))
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))
    const valid = expected.length === signature.length && expected.every((value, index) => value === signature[index])
    return valid ? payload : null
  } catch { return null }
}
