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
const clean = value => String(value || '').replace(/\D/g, '')
const formatCode = value => String(value || '').replace(/[^A-Za-z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2')

function getRepo() {
  if (existsSync(path.join(root, 'package.json'))) return
  const tmp = mkdirSync(path.join(tmpdir(), `stain-${Date.now()}`), { recursive: true })
  try {
    console.log('\nStain × Habibi - downloading repository...\n')
    run(`git clone --depth 1 ${repo} "${tmp}/repo"`)
    cpSync(path.join(tmp, 'repo'), root, { recursive: true, force: true })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function applyConfig() {
  for (const [key, value] of Object.entries(CONFIG)) {
    if (value !== '') process.env[key] = String(value)
  }
}

async function pair() {
  const { default: makeWASocket, Browsers, useMultiFileAuthState, fetchLatestWaWebVersion } = await import('@iamvanss/baileys')
  const { default: pino } = await import('pino')
  const authDir = path.join(root, 'auth_info_baileys')
  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  if (state.creds.registered) return

  const phone = clean(CONFIG.PHONE_NUMBER)
  if (!phone || phone.length < 8 || phone.length > 15) {
    throw new Error('Enter your WhatsApp phone number in PHONE_NUMBER at the top of start.js.')
  }

  let version
  try { version = (await fetchLatestWaWebVersion()).version } catch {}

  const sock = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false
  })

  sock.ev.on('creds.update', saveCreds)

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WhatsApp socket did not become ready.')), 30000)
    const onUpdate = update => {
      if (update.connection === 'open') {
        clearTimeout(timer)
        sock.ev.off('connection.update', onUpdate)
        resolve()
      }
      if (update.connection === 'close') {
        clearTimeout(timer)
        sock.ev.off('connection.update', onUpdate)
        reject(update.lastDisconnect?.error || new Error('WhatsApp connection closed.'))
      }
    }
    sock.ev.on('connection.update', onUpdate)
  })

  console.log('\nGenerating WhatsApp pairing code...\n')
  const code = await sock.requestPairingCode(phone)
  console.log(`Pairing code: ${formatCode(code)}`)
  console.log('WhatsApp → Linked Devices → Link a Device → enter the code.\n')

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pairing timed out. Enter the code on WhatsApp before the 5-minute limit.')), 300000)
    const onCreds = update => {
      if (update?.registered || state.creds.registered) {
        clearTimeout(timer)
        sock.ev.off('creds.update', onCreds)
        sock.ev.off('connection.update', onUpdate)
        resolve()
      }
    }
    const onUpdate = update => {
      if (update.connection === 'close' && !state.creds.registered) {
        clearTimeout(timer)
        sock.ev.off('creds.update', onCreds)
        sock.ev.off('connection.update', onUpdate)
        reject(update.lastDisconnect?.error || new Error('WhatsApp connection closed during pairing.'))
      }
    }
    sock.ev.on('creds.update', onCreds)
    sock.ev.on('connection.update', onUpdate)
  })

  await saveCreds()
  sock.end?.()
}

applyConfig()
getRepo()
if (!existsSync(path.join(root, 'node_modules', '@iamvanss', 'baileys'))) run('npm install --legacy-peer-deps')
await pair()

console.log('\n✓ WhatsApp paired. Starting Stain × Habibi...\n')
const child = spawn(process.execPath, ['index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
