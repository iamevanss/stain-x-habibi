import { existsSync, cpSync, mkdirSync, rmSync } from 'fs'
import { execSync, spawn } from 'child_process'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const CONFIG = {
  PHONE_NUMBER: '',
  OWNER_NUMBER: '',
  PREFIX: '.',
  BOT_NAME: '',
  TELEGRAM_BOT_TOKEN: ''
}

const root = path.dirname(fileURLToPath(import.meta.url))
const repo = 'https://github.com/iamevanss/stain-x-habibi.git'
const run = cmd => execSync(cmd, { cwd: root, stdio: 'inherit', env: process.env, timeout: 600000 })

function getRepo() {
  if (existsSync(path.join(root, 'package.json'))) return
  const tmp = mkdirSync(path.join(tmpdir(), `stain-${Date.now()}`), { recursive: true })
  try {
    run(`git clone --depth 1 ${repo} "${tmp}/repo"`)
    cpSync(path.join(tmp, 'repo'), root, { recursive: true, force: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function applyConfig() {
  for (const [key, value] of Object.entries(CONFIG)) {
    if (value !== '') process.env[key] = value
  }
}

function phone() {
  const value = String(CONFIG.PHONE_NUMBER || '').replace(/\D/g, '')
  if (!value) throw new Error('Enter your WhatsApp phone number in PHONE_NUMBER at the top of start.js.')
  if (value.length < 8 || value.length > 15) throw new Error('PHONE_NUMBER must include the country code and contain digits only.')
  process.env.PHONE_NUMBER = value
}

applyConfig()
getRepo()
phone()
if (!existsSync(path.join(root, 'node_modules'))) run('npm install --legacy-peer-deps')

const child = spawn(process.execPath, ['index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
