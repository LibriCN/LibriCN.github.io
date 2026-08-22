import { randomBytes, pbkdf2Sync } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'

const username = process.argv[2]
const target = process.argv.includes('--local') ? '--local' : '--remote'
if (!username || !username.includes('@')) {
  console.error('Uso: node worker/scripts/create-admin.mjs email@exemplo.com [--local]')
  process.exit(1)
}

const readline = createInterface({ input, output })
const password = await readline.question(`Senha para ${username} (mínimo 8 caracteres): `, { hideEchoBack: true })
readline.close()
if (password.length < 8) {
  console.error('A senha precisa ter pelo menos 8 caracteres.')
  process.exit(1)
}

const iterations = 100_000
const salt = randomBytes(16)
const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
const hash = `pbkdf2$${iterations}$${salt.toString('base64')}$${derived.toString('base64')}`
const safeUsername = username.toLowerCase().replaceAll("'", "''")
const sql = `INSERT INTO admins (username,password_hash,role,is_active,created_at) VALUES ('${safeUsername}','${hash}','admin',1,datetime('now'));`
const workerDirectory = fileURLToPath(new URL('..', import.meta.url))
const command = process.execPath
const wranglerEntry = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const result = spawnSync(command, [wranglerEntry, 'd1', 'execute', 'livro-perto-db', target, '--command', sql], { stdio: 'inherit', cwd: workerDirectory })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
