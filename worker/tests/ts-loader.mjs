import { access } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
    const candidate = new URL(specifier + '.ts', context.parentURL)
    try {
      await access(fileURLToPath(candidate))
      return { url: pathToFileURL(fileURLToPath(candidate)).href, shortCircuit: true }
    } catch { /* tenta o resolvedor padrão */ }
  }
  return nextResolve(specifier, context)
}
