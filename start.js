import { existsSync, cpSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { execSync, spawn } from 'child_process'
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const repo = 'https://github.com/iamevanss/stain-x-habibi.git'
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit', env: process.env, timeout: 600000 })
const clean = v => String(v || '').replace(/\D/g, '')
const format = v => String(v || '').replace(/[^A-Za-z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2')

function loadEnv() {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); if (k && !process.env[k]) process.env[k] = v.replace(/^[\"']|[\"']$/g, '') }
  }
}

function getRepo() {
  if (existsSync(path.join(root, 'package.json'))) return
  const tmp = mkdirSync(path.join(tmpdir(), `stain-${Date.now()}`), { recursive: true })
  try {
    console.log('\nStain × Habibi - downloading full repository...\n')
    run(`git clone --depth 1 ${repo} "${tmp}/repo"`)
    cpSync(path.join(tmp, 'repo'), root, { recursive: true, force: true })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

async function getPhone() {
  let phone = clean(process.env.PHONE_NUMBER)
  if (phone) return phone
  if (!process.stdin.isTTY) throw new Error('Set PHONE_NUMBER in the panel environment.')
  const rl = createInterface({ input, output })
  try {
    while (phone.length < 8 || phone.length > 15) {
      phone = clean(await rl.question('WhatsApp phone number (country code, digits only): '))
    }
    return phone
  } finally { rl.close() }
}

async function pair() {
  const { default: makeWASocket, Browsers, useMultiFileAuthState, fetchLatestWaWebVersion } = await import('@whiskeysockets/baileys')
  const { default: pino } = await import('pino')
  const authDir = path.join(root, 'auth_info_baileys')
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  if (state.creds.registered) return

  const phone = await getPhone()
  let version
  try { version = (await fetchLatestWaWebVersion()).version } catch {}
  const sock = makeWASocket({ auth: state, ...(version ? { version } : {}), logger: pino({ level: 'silent' }), browser: Browsers.macOS('Chrome'), printQRInTerminal: false, syncFullHistory: false })
  sock.ev.on('creds.update', saveCreds)

  const connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pairing timed out.')), 300000)
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') { clearTimeout(timer); resolve() }
      if (connection === 'close') { clearTimeout(timer); reject(lastDisconnect?.error || new Error('WhatsApp connection closed.')) }
    })
  })

  console.log('\nGenerating WhatsApp pairing code...\n')
  console.log(`Pairing code: ${format(await sock.requestPairingCode(phone))}`)
  console.log('WhatsApp → Linked Devices → Link a Device → enter the code.\n')
  await connected
  sock.end?.()
}

loadEnv()
getRepo()
if (!existsSync(path.join(root, 'node_modules'))) run('npm install --legacy-peer-deps')
await pair()
console.log('\n✓ WhatsApp paired. Starting Stain × Habibi...\n')
const child = spawn(process.execPath, ['index.js'], { cwd: root, stdio: 'inherit', env: process.env })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
