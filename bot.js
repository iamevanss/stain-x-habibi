import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestWaWebVersion,
    Browsers,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    isJidGroup,
    isJidBroadcast,
    downloadContentFromMessage
} from '@whiskeysockets/baileys'
import pino from 'pino'
import chalk from 'chalk'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { handleMessage, handleGroupParticipantsUpdate } from './lib/handler.js'
import { handleModernGroupUpdate } from './lib/enhancements.js'
import { loadData, saveData, getOwner, setOwner } from './lib/store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Load .env from cwd and bot folder (panels sometimes only write a file) */
function loadEnvFile() {
    const candidates = [
        path.join(process.cwd(), '.env'),
        path.join(__dirname, '.env'),
        path.join(__dirname, '..', '.env'),
        path.join(__dirname, 'data', 'tg_token.txt'),
        path.join(process.cwd(), 'data', 'tg_token.txt')
    ]
    for (const file of candidates) {
        try {
            if (!fs.existsSync(file)) continue
            const raw = fs.readFileSync(file, 'utf8')
            // Plain token file (data/tg_token.txt)
            if (file.endsWith('tg_token.txt')) {
                const tok = raw.trim().replace(/^["']|["']$/g, '')
                if (tok && !process.env.TELEGRAM_BOT_TOKEN) {
                    process.env.TELEGRAM_BOT_TOKEN = tok
                    console.log('[env] TELEGRAM_BOT_TOKEN loaded from', file)
                }
                continue
            }
            const lines = raw.split(/\r?\n/)
            for (const line of lines) {
                const t = line.trim()
                if (!t || t.startsWith('#')) continue
                const eq = t.indexOf('=')
                if (eq < 1) continue
                const key = t.slice(0, eq).trim()
                let val = t.slice(eq + 1).trim()
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1)
                }
                // Overwrite if missing OR empty (panels often set blank vars)
                if (key && (!process.env[key] || String(process.env[key]).trim() === '')) {
                    process.env[key] = val
                }
            }
            console.log('[env] loaded', file)
        } catch (e) {
            console.error('[env]', e.message)
        }
    }
}
loadEnvFile()

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys')
const PREFIX = process.env.PREFIX || '.'
const BOT_NAME = process.env.BOT_NAME || '𝘚𝘵𝘢𝘪𝘯 𝘹 𝘏𝘢𝘣𝘪𝘣𝘪'

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim()

let sock = null
let reconnectAttempts = 0
const MAX_RECONNECT = 15

// Group metadata cache (same idea as Habibi)
const GROUP_METADATA_TTL_MS = 5 * 60 * 1000
const groupMetadataCache = new Map()

function getCachedGroupMetadata(jid) {
    const entry = groupMetadataCache.get(jid)
    if (!entry) return undefined
    if (Date.now() - entry.time > GROUP_METADATA_TTL_MS) {
        groupMetadataCache.delete(jid)
        return undefined
    }
    return entry.data
}

function setCachedGroupMetadata(jid, data) {
    groupMetadataCache.set(jid, { data, time: Date.now() })
}

async function refreshGroupMetadataCache(sock, jid) {
    try {
        const meta = await sock.groupMetadata(jid)
        setCachedGroupMetadata(jid, meta)
        return meta
    } catch {
        return null
    }
}

async function connectToWhatsApp() {
    await fs.ensureDir(AUTH_DIR)
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

    let version
    try {
        const waVersion = await fetchLatestWaWebVersion()
        version = waVersion.version
        console.log(chalk.gray(`[WA] Using version ${version?.join('.')}`))
    } catch {
        console.warn(chalk.yellow('[WA] Could not fetch latest version, using default'))
    }

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
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
        autoFollow: false, // don't auto-follow newsletters/channels (xazepysk/wbails)
        getMessage: async () => undefined,
        cachedGroupMetadata: async (jid) => getCachedGroupMetadata(jid),
        shouldIgnoreJid: (jid) => isJidBroadcast(jid)
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr && !sock.authState.creds.registered) {
            console.log(chalk.yellow('\n[PAIR] No saved WhatsApp session found.'))
            console.log(chalk.cyan('[PAIR] Public pairing is handled by the official Stain × Habibi website.'))
            console.log(chalk.cyan('[PAIR] Complete pairing on the website, then deploy the generated bootstrap.\n'))
        }

        if (connection === 'open') {
            reconnectAttempts = 0
            const botJid = jidNormalizedUser(sock.user?.id || '')
            const botNumber = String(botJid).split(':')[0].split('@')[0].replace(/\D/g, '')
            if (process.env.OWNER_NUMBER) {
                setOwner(process.env.OWNER_NUMBER)
            } else {
                setOwner(botNumber)
            }
            const ownNow = getOwner()
            console.log(chalk.green.bold(`\n✦ ${BOT_NAME} is online`))
            console.log(chalk.green(`  Connected as: ${botNumber}`))
            console.log(chalk.green(`  Owner number: ${ownNow || 'NOT SET'}`))
            console.log(chalk.gray(`  Mode: .private / .public`))
            console.log(chalk.gray(`  Prefix: ${PREFIX}`))
            console.log(chalk.gray(`  Works in DMs & Groups\n`))
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut

            console.log(chalk.yellow(`[CONN] Closed (code ${statusCode}). Reconnect: ${shouldReconnect}`))

            if (statusCode === DisconnectReason.loggedOut) {
                console.log(chalk.red('[CONN] Logged out. Delete auth_info_baileys and restart to re-pair.'))
                return
            }

            if (shouldReconnect && reconnectAttempts < MAX_RECONNECT) {
                reconnectAttempts++
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000)
                console.log(chalk.yellow(`[CONN] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`))
                setTimeout(connectToWhatsApp, delay)
            } else if (reconnectAttempts >= MAX_RECONNECT) {
                console.log(chalk.red('[CONN] Max reconnect attempts reached. Restart the process.'))
            }
        }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return
        for (const msg of messages) {
            try {
                await handleMessage(sock, msg, {
                    prefix: PREFIX,
                    botName: BOT_NAME,
                    getCachedGroupMetadata,
                    setCachedGroupMetadata,
                    refreshGroupMetadataCache
                })
            } catch (err) {
                console.error(chalk.red('[MSG] Handler error:'), err.message)
            }
        }
    })

    sock.ev.on('group-participants.update', async (update) => {
        try {
            await handleModernGroupUpdate(sock, update)
            await handleGroupParticipantsUpdate(sock, update, { botName: BOT_NAME })
            if (update?.id) refreshGroupMetadataCache(sock, update.id)
        } catch (err) {
            console.error(chalk.red('[GROUP] Participants update error:'), err.message)
        }
    })

    sock.ev.on('groups.update', (updates) => {
        for (const u of updates) {
            if (u?.id) refreshGroupMetadataCache(sock, u.id)
        }
    })
}

// Boot
console.log(chalk.magenta.bold(`\n𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶  starting...\n`))
loadData()
connectToWhatsApp().catch((err) => {
    console.error(chalk.red('Fatal connection error:'), err)
    process.exit(1)
})

// Keep process alive
process.on('uncaughtException', (err) => {
    console.error(chalk.red('[UNCAUGHT]'), err.message)
})
process.on('unhandledRejection', (err) => {
    console.error(chalk.red('[UNHANDLED]'), err?.message || err)
})
