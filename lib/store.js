import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const WARNS_FILE = path.join(DATA_DIR, 'warns.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

let warns = {}
let settings = {
    owner: null,
    sudo: [],
    mode: 'public', // public | private
    antilink: {},   // groupId -> 'off' | 'delete' | 'warn' | 'kick' (legacy true=delete)
    antigstatus: {}, // groupId -> true/false
    welcome: {},
    antibot: {},
    telegramToken: null
}

export function loadData() {
    fs.ensureDirSync(DATA_DIR)
    try {
        if (fs.existsSync(WARNS_FILE)) warns = fs.readJsonSync(WARNS_FILE)
    } catch { warns = {} }
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const loaded = fs.readJsonSync(SETTINGS_FILE)
            settings = { ...settings, ...loaded }
            if (!Array.isArray(settings.sudo)) settings.sudo = []
            if (!settings.mode) settings.mode = 'public'
        }
    } catch {}
    // Env override always wins for owner
    if (process.env.OWNER_NUMBER) {
        settings.owner = cleanNumber(process.env.OWNER_NUMBER)
    }
    if (process.env.PHONE_NUMBER && !settings.owner) {
        settings.owner = cleanNumber(process.env.PHONE_NUMBER)
    }
    // Sync stored telegram token into process env
    if (settings.telegramToken && !process.env.TELEGRAM_BOT_TOKEN) {
        process.env.TELEGRAM_BOT_TOKEN = String(settings.telegramToken).trim()
    }
}

export function saveData() {
    try {
        fs.writeJsonSync(WARNS_FILE, warns, { spaces: 2 })
        fs.writeJsonSync(SETTINGS_FILE, settings, { spaces: 2 })
    } catch (e) {
        console.error('Failed to save data:', e.message)
    }
}

export function cleanNumber(jidOrNumber) {
    if (!jidOrNumber) return ''
    let s = String(jidOrNumber)
    // strip device suffix 234xxx:12@s.whatsapp.net
    s = s.split(':')[0]
    s = s.split('@')[0]
    s = s.replace(/\D/g, '')
    return s
}

export function getOwner() {
    return settings.owner
}

export function setOwner(number) {
    // Don't override explicit env owner
    if (process.env.OWNER_NUMBER) {
        settings.owner = cleanNumber(process.env.OWNER_NUMBER)
        saveData()
        return
    }
    const clean = cleanNumber(number)
    if (clean) {
        settings.owner = clean
        saveData()
    }
}

export function isOwner(jidOrNumber) {
    const clean = cleanNumber(jidOrNumber)
    const owner = getOwner()
    if (!owner || !clean) return false
    return clean === owner
}

export function isSudo(jidOrNumber) {
    const clean = cleanNumber(jidOrNumber)
    return (settings.sudo || []).includes(clean)
}

export function isOwnerOrSudo(jidOrNumber) {
    return isOwner(jidOrNumber) || isSudo(jidOrNumber)
}

export function getSudoList() {
    return [...(settings.sudo || [])]
}

export function addSudo(jidOrNumber) {
    const clean = cleanNumber(jidOrNumber)
    if (!clean) return false
    if (!settings.sudo) settings.sudo = []
    if (settings.sudo.includes(clean)) return false
    settings.sudo.push(clean)
    saveData()
    return true
}

export function removeSudo(jidOrNumber) {
    const clean = cleanNumber(jidOrNumber)
    if (!settings.sudo) return false
    const before = settings.sudo.length
    settings.sudo = settings.sudo.filter((s) => s !== clean)
    if (settings.sudo.length === before) return false
    saveData()
    return true
}

export function getMode() {
    return settings.mode || 'public'
}

export function setMode(mode) {
    settings.mode = mode === 'private' ? 'private' : 'public'
    saveData()
    return settings.mode
}

export function getWarns(groupId, userId) {
    return (warns[groupId] || {})[userId] || 0
}

export function addWarn(groupId, userId) {
    if (!warns[groupId]) warns[groupId] = {}
    warns[groupId][userId] = (warns[groupId][userId] || 0) + 1
    saveData()
    return warns[groupId][userId]
}

export function resetWarn(groupId, userId) {
    if (!warns[groupId]) return
    delete warns[groupId][userId]
    saveData()
}

export function resetAllWarns(groupId) {
    delete warns[groupId]
    saveData()
}

export function getSetting(key, groupId) {
    if (!settings[key]) return false
    return !!settings[key][groupId]
}

export function setSetting(key, groupId, value) {
    if (!settings[key]) settings[key] = {}
    settings[key][groupId] = value
    saveData()
}

/** Antilink modes: off | delete | warn | kick */
export function getAntilinkMode(groupId) {
    const v = settings.antilink?.[groupId]
    if (v === true || v === 'on') return 'delete'
    if (v === false || v === 'off' || !v) return 'off'
    const m = String(v).toLowerCase()
    if (['delete', 'warn', 'kick'].includes(m)) return m
    return 'off'
}

export function setAntilinkMode(groupId, mode) {
    const m = String(mode).toLowerCase()
    if (!settings.antilink) settings.antilink = {}
    if (m === 'off') settings.antilink[groupId] = 'off'
    else if (['delete', 'warn', 'kick'].includes(m)) settings.antilink[groupId] = m
    else return false
    saveData()
    return true
}

export function isAntigstatus(groupId) {
    return !!settings.antigstatus?.[groupId]
}

export function setAntigstatus(groupId, value) {
    if (!settings.antigstatus) settings.antigstatus = {}
    settings.antigstatus[groupId] = !!value
    saveData()
}

export function getStoredTelegramToken() {
    return settings.telegramToken || null
}

export function setStoredTelegramToken(token) {
    settings.telegramToken = token ? String(token).trim() : null
    saveData()
}
