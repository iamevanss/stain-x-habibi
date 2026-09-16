/**
 * Stain × Habibi Bootstrap
 *
 * This file is the public entry point for panel deployments.
 * It installs dependencies when needed, asks for a WhatsApp number when
 * there is no saved session, creates the pairing code locally, saves the
 * Baileys session inside this installation, then starts the real bot.
 */
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.join(__dirname, 'auth_info_baileys')
const BAILEYS_DIR = path.join(__dirname, 'node_modules', '@whiskeysockets', 'baileys')

function installDependencies() {
    if (existsSync(BAILEYS_DIR)) return

    console.log('')
    console.log('════════════════════════════════════════════')
    console.log('  Stain × Habibi - first-time setup')
    console.log('  Installing dependencies...')
    console.log('════════════════════════════════════════════')
    console.log('')

    try {
        execSync('npm install --legacy-peer-deps', {
            stdio: 'inherit',
            cwd: __dirname,
            env: process.env,
            timeout: 600000
        })
    } catch (err) {
        console.error('')
        console.error('✗ Dependency installation failed.')
        console.error(err?.message || err)
        process.exit(1)
    }
}

function normalisePhone(value) {
    return String(value || '').replace(/\D/g, '')
}

function formatPairingCode(code) {
    const clean = String(code || '').replace(/[^A-Za-z0-9]/g, '')
    return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

async function askForPhoneNumber() {
    if (process.env.PHONE_NUMBER) {
        const envNumber = normalisePhone(process.env.PHONE_NUMBER)
        if (envNumber) return envNumber
    }

    if (!process.stdin.isTTY) {
        console.error('✗ No interactive console is available.')
        console.error('Set PHONE_NUMBER in the panel environment and restart.')
        process.exit(1)
    }

    const rl = createInterface({ input, output })

    try {
        console.log('')
        console.log('════════════════════════════════════════════')
        console.log('  WhatsApp pairing')
        console.log('════════════════════════════════════════════')
        console.log('')
        console.log('Enter your WhatsApp phone number with country code.')
        console.log('Example: 2348012345678')
        console.log('Do not include +, spaces or dashes.')
        console.log('')

        while (true) {
            const answer = await rl.question('Phone number: ')
            const phone = normalisePhone(answer)

            if (phone.length >= 8 && phone.length <= 15) {
                return phone
            }

            console.log('Invalid phone number. Please enter the number with country code.')
        }
    } finally {
        rl.close()
    }
}

async function pairWhatsApp() {
    const { default: makeWASocket, Browsers, useMultiFileAuthState, fetchLatestWaWebVersion } = await import('@whiskeysockets/baileys')
    const { default: pino } = await import('pino')

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

    if (state.creds.registered) {
        console.log('')
        console.log('✓ Saved WhatsApp session found.')
        console.log('✓ Starting Stain × Habibi...')
        console.log('')
        return
    }

    const phone = await askForPhoneNumber()

    let version
    try {
        const latest = await fetchLatestWaWebVersion()
        version = latest.version
    } catch {
        console.log('[WA] Could not fetch latest WhatsApp Web version. Using default.')
    }

    const sock = makeWASocket({
        auth: state,
        ...(version ? { version } : {}),
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Chrome'),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        autoFollow: false
    })

    sock.ev.on('creds.update', saveCreds)

    let opened = false
    let settled = false

    const pairingFinished = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (settled) return
            settled = true
            reject(new Error('Pairing timed out after 5 minutes.'))
        }, 5 * 60 * 1000)

        sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                opened = true
                clearTimeout(timeout)
                if (!settled) {
                    settled = true
                    resolve()
                }
                return
            }

            if (connection === 'close' && !opened && !settled) {
                clearTimeout(timeout)
                settled = true
                const statusCode = lastDisconnect?.error?.output?.statusCode
                reject(new Error(`WhatsApp connection closed${statusCode ? ` (code ${statusCode})` : ''}.`))
            }
        })
    })

    try {
        console.log('')
        console.log('Generating your pairing code...')
        console.log('')

        const rawCode = await sock.requestPairingCode(phone)
        const code = formatPairingCode(rawCode)

        console.log('════════════════════════════════════════════')
        console.log('  YOUR WHATSAPP PAIRING CODE')
        console.log('')
        console.log(`             ${code}`)
        console.log('')
        console.log('  WhatsApp → Linked Devices → Link a Device')
        console.log('  Enter the code above when prompted.')
        console.log('════════════════════════════════════════════')
        console.log('')
        console.log('Waiting for WhatsApp to confirm the pairing...')

        await pairingFinished

        console.log('')
        console.log('✓ WhatsApp connected.')
        console.log('✓ Session saved to auth_info_baileys/.')
        console.log('✓ Starting Stain × Habibi...')
        console.log('')
    } catch (err) {
        try {
            sock.end?.(err)
        } catch {}
        console.error('')
        console.error(`✗ Pairing failed: ${err?.message || err}`)
        console.error('Restart the bot to try pairing again.')
        console.error('')
        process.exit(1)
    }

    try {
        sock.end?.(new Error('Bootstrap pairing complete'))
    } catch {}
}

async function main() {
    installDependencies()
    await pairWhatsApp()
    await import('./bot.js')
}

main().catch((err) => {
    console.error('Fatal bootstrap error:', err?.message || err)
    process.exit(1)
})
