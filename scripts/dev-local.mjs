import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const workerDir = path.join(rootDir, 'worker')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function runSetup(script) {
  const result = spawnSync(npmCommand, ['run', script], { cwd: rootDir, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

runSetup('dev:setup')

const children = []
const stop = (code = 0) => {
  for (const child of children) if (!child.killed) child.kill('SIGTERM')
  process.exit(code)
}

const api = spawn(npmCommand, ['run', 'dev'], { cwd: workerDir, stdio: 'inherit', shell: process.platform === 'win32' })
const web = spawn(npmCommand, ['run', 'dev', '--', '--host', '0.0.0.0'], {
  cwd: rootDir,
  env: { ...process.env, VITE_API_URL: process.env.VITE_API_URL || 'http://localhost:8787' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
children.push(api, web)

api.on('exit', code => { if (code && code !== 143) stop(code) })
web.on('exit', code => { if (code && code !== 143) stop(code) })
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

console.log('\nLivro Perto local:')
console.log('  Frontend: http://localhost:5173')
console.log('  API:      http://localhost:8787')
console.log('  Admin:    http://localhost:5173/admin/login')
console.log('  Login:    admin@livroperto.org / livroperto')
