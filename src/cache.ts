type CacheEntry<T> = { value: T; expiresAt: number }

const memory = new Map<string, CacheEntry<unknown>>()
const storagePrefix = 'livro-perto-cache:'

export function readCache<T>(key: string): T | null {
  const now = Date.now()
  const inMemory = memory.get(key) as CacheEntry<T> | undefined
  if (inMemory && inMemory.expiresAt > now) return inMemory.value
  if (inMemory) memory.delete(key)
  try {
    const raw = localStorage.getItem(`${storagePrefix}${key}`)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (entry.expiresAt <= now) { localStorage.removeItem(`${storagePrefix}${key}`); return null }
    memory.set(key, entry)
    return entry.value
  } catch { return null }
}

export function writeCache<T>(key: string, value: T, ttlMs: number) {
  const entry: CacheEntry<T> = { value, expiresAt: Date.now() + ttlMs }
  memory.set(key, entry)
  try { localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(entry)) } catch { /* cache é opcional */ }
  return value
}

export function invalidateCache(prefix = '') {
  for (const key of memory.keys()) if (!prefix || key.startsWith(prefix)) memory.delete(key)
  try {
    const keys = Object.keys(localStorage)
    keys.filter(key => key.startsWith(`${storagePrefix}${prefix}`)).forEach(key => localStorage.removeItem(key))
  } catch { /* cache é opcional */ }
}
