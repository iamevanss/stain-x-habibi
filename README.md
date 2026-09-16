# Stain × Habibi

**WhatsApp Multi-Device bot** for private chats and groups.

## Features

- Group administration and moderation
- Media, stickers, TTS and Telegram sticker packs
- Owner and sudo tools
- Private/public mode
- WhatsApp Multi-Device
- Local persistent Baileys sessions
- Local first-time pairing - no external pairing website

## Requirements

- Node.js 20.9+
- Git
- FFmpeg for media features
- A VPS, panel or host that can run Node.js

## Panel deployment

The recommended panel setup uses **`start.js`** as the startup/bootstrap file.

### 1. Create `start.js`

Download `start.js` from this repository, or copy the script below into a new panel file named exactly:

```text
start.js
```

The code block has GitHub's built-in **Copy** button.

### 2. Start it

```bash
node start.js
```

`start.js` will:

1. Clone the full Stain × Habibi repository into the current installation if it is not already present.
2. Install the bot dependencies.
3. Read the panel environment or local `.env` values.
4. Check for an existing `auth_info_baileys/` session.
5. If no session exists, use `PHONE_NUMBER` or ask for the WhatsApp number in an interactive console.
6. Generate a WhatsApp pairing code locally.
7. Save the WhatsApp session locally.
8. Start the real `index.js` bot.

On later restarts, the saved session is reused and pairing is skipped.

**Download:** [start.js](./start.js)

<details>
<summary><strong>Copy start.js</strong></summary>

```js
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
```

</details>

## Environment

Use these variables in the panel or in a local `.env`:

```env
PHONE_NUMBER=
OWNER_NUMBER=
PREFIX=.
BOT_NAME=
TELEGRAM_BOT_TOKEN=
```

- `PHONE_NUMBER` - WhatsApp number used for first-time pairing. If blank, `start.js` asks for it when an interactive console is available.
- `OWNER_NUMBER` - owner phone number in digits. If blank, the paired bot number is used.
- `PREFIX` - command prefix. Default: `.`
- `BOT_NAME` - bot display name.
- `TELEGRAM_BOT_TOKEN` - optional token used by Telegram sticker-pack features.

Do not commit real credentials or tokens.

## Session

WhatsApp authentication is stored locally in:

```text
auth_info_baileys/
```

Keep this directory private. Do not upload or share its contents.

## Dependency

Stain × Habibi uses the following Baileys setup:

```json
"dependencies": {
  "@whiskeysockets/baileys": "^7.0.0-rc.11",
  "libsignal": "6.0.0"
},
"overrides": {
  "libsignal": "6.0.0",
  "@whiskeysockets/baileys": {
    "libsignal": "6.0.0"
  }
}
```

## Direct VPS deployment

If the repository is already cloned, you can skip `start.js` and run:

```bash
npm install --legacy-peer-deps
npm start
```

## License

[Proprietary - All Rights Reserved](./LICENSE)
