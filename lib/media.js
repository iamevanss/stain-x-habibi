import axios from 'axios'
import yts from 'yt-search'
import googleTTS from 'google-tts-api'
import Jimp from 'jimp'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'
import { downloadContentFromMessage } from '@whiskeysockets/baileys'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.join(__dirname, '..', 'tmp')
fs.ensureDirSync(TMP)

export async function downloadMediaMsg(msg) {
    const m = msg.message || {}
    let type = Object.keys(m).find(k => k.includes('Message') || k === 'conversation')
    if (!type) throw new Error('No media found')
    if (m.ephemeralMessage) return downloadMediaMsg({ message: m.ephemeralMessage.message, key: msg.key })
    if (m.viewOnceMessage) return downloadMediaMsg({ message: m.viewOnceMessage.message, key: msg.key })
    if (m.viewOnceMessageV2) return downloadMediaMsg({ message: m.viewOnceMessageV2.message, key: msg.key })
    const content = m[type]
    if (!content) throw new Error('No media content')
    const mediaType = type.replace('Message', '').toLowerCase()
    const stream = await downloadContentFromMessage(content, mediaType === 'image' || mediaType === 'sticker' ? mediaType : mediaType)
    let buffer = Buffer.alloc(0)
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])
    }
    return { buffer, type, mimetype: content.mimetype || 'application/octet-stream' }
}

const DEFAULT_PACK = '𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶'
const DEFAULT_AUTHOR = '𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶'

function isWebpBuffer(buf) {
    return Buffer.isBuffer(buf) && buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45
}

function buildStickerExif(pack, author) {
    const json = JSON.stringify({
        'sticker-pack-id': 'com.habibi.mugs.you.sticker',
        'sticker-pack-name': pack || DEFAULT_PACK,
        'sticker-pack-publisher': author || DEFAULT_AUTHOR,
        'emojis': ['✨'],
        'sticker-pack-publisher-website': '',
        'sticker-pack-publisher-id': '',
        'android-app-store-link': '',
        'ios-app-store-link': ''
    })
    const jsonBuf = Buffer.from(json, 'utf8')
    const exif = Buffer.concat([
        Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]),
        jsonBuf
    ])
    exif.writeUIntLE(jsonBuf.length, 14, 4)
    return exif
}

async function embedStickerExif(webpBuffer, pack, author) {
    const { Image } = await import('node-webpmux')
    const img = new Image()
    await img.load(webpBuffer)
    img.exif = buildStickerExif(pack, author)
    return await img.save(null)
}

async function toWebpSticker(buffer) {
    const sharp = (await import('sharp')).default
    return await sharp(buffer).ensureAlpha().resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 100, alphaQuality: 100, lossless: false, effort: 4 }).toBuffer()
}

export async function createSticker(buffer, pack = DEFAULT_PACK, author = DEFAULT_AUTHOR) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 100) throw new Error('Invalid image buffer')
    let webp
    try { webp = await toWebpSticker(buffer) } catch (e) { throw new Error('Need sharp to make stickers. Wait for install or restart. (' + (e.message || e) + ')') }
    if (!isWebpBuffer(webp)) throw new Error('WebP conversion failed — sticker would show no info')
    try { webp = await embedStickerExif(webp, pack, author) } catch (e) { console.error('[sticker:exif]', e?.message || e) }
    return webp
}

export async function setStickerPack(buffer, pack = DEFAULT_PACK, author = DEFAULT_AUTHOR) {
    try {
        let webp = buffer
        if (!isWebpBuffer(webp)) webp = await toWebpSticker(buffer)
        return await embedStickerExif(webp, pack, author)
    } catch (e) {
        console.error('[setStickerPack]', e?.message || e)
        return buffer
    }
}

export async function stickerToImage(buffer) {
    try { const sharp = (await import('sharp')).default; return await sharp(buffer).png().toBuffer() } catch {}
    try { const img = await Jimp.read(buffer); return await img.getBufferAsync(Jimp.MIME_PNG) } catch {}
    throw new Error('Cannot convert this sticker (WebP). Install sharp on panel or use a static sticker.')
}

export async function textToSpeech(text, lang = 'en') {
    const clean = String(text || '').trim().slice(0, 200)
    if (!clean) throw new Error('Provide text (max 200 characters)')
    const url = googleTTS.getAudioUrl(clean, { lang: lang || 'en', slow: false, host: 'https://translate.google.com' })
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })
    return Buffer.from(res.data)
}

export async function getLyrics(query) {
    const q = String(query || '').trim()
    if (!q) throw new Error('Provide song name')
    try {
        const { data } = await axios.get(`https://lyrist.vercel.app/api/${encodeURIComponent(q)}`, { timeout: 12000 })
        if (data?.lyrics) return { title: data.title || q, artist: data.artist || 'Unknown', lyrics: String(data.lyrics).slice(0, 3800) }
    } catch {}
    try {
        const { data } = await axios.get(`https://some-random-api.com/lyrics?title=${encodeURIComponent(q)}`, { timeout: 12000 })
        if (data?.lyrics) return { title: data.title || q, artist: data.author || 'Unknown', lyrics: String(data.lyrics).slice(0, 3800) }
    } catch {}
    throw new Error('Lyrics not found for that query')
}

export async function searchAndGetAudio(query) {
    let title = query, url = null, duration = '', thumbnail = ''
    try {
        const api = `https://api.sayan-nexuswork.workers.dev/music?query=${encodeURIComponent(query)}`
        const { data } = await axios.get(api, { timeout: 30000 })
        if (data?.status === 'success' && data?.url) {
            const audioRes = await axios.get(data.url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 20 * 1024 * 1024, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://m.youtube.com/' } })
            if (audioRes.data && audioRes.data.byteLength > 1000) {
                return { buffer: Buffer.from(audioRes.data), title: data.title || title, url: data.video_url || data.url || '', duration: data.duration || '', thumbnail: data.thumbnail || '' }
            }
        }
    } catch (e) { console.error('[play:sayan]', e?.message || e) }
    try {
        const vreden = await import('@vreden/youtube_scraper')
        const yt = vreden.default || vreden
        const ytmp3 = yt.ytmp3 || vreden.ytmp3
        const searchFn = yt.search || vreden.search
        const isUrl = /youtube\.com|youtu\.be/i.test(query)
        if (isUrl) url = query
        else if (typeof searchFn === 'function') {
            const sr = await searchFn(query)
            const results = sr?.results || sr?.data || (Array.isArray(sr) ? sr : null)
            const first = results?.[0]
            if (first) { url = first.url || (first.videoId ? `https://www.youtube.com/watch?v=${first.videoId}` : null); title = first.title || title; duration = first.timestamp || first.duration || ''; thumbnail = first.thumbnail || first.image || '' }
        }
        if (!url) {
            const ytsMod = (await import('yt-search')).default
            const s = await ytsMod(query)
            const video = s.videos?.[0]
            if (!video) throw new Error('No results found on YouTube')
            url = video.url; title = video.title; duration = video.timestamp || ''; thumbnail = video.thumbnail || ''
        }
        if (typeof ytmp3 === 'function') {
            const result = await ytmp3(url, 128)
            const status = result?.status !== false
            const dl = result?.download?.url || result?.download || result?.result?.download || result?.result?.url || result?.url || result?.link
            const meta = result?.metadata || result?.result?.metadata || {}
            if (status && dl && typeof dl === 'string' && dl.startsWith('http')) {
                const audioRes = await axios.get(dl, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 20 * 1024 * 1024, headers: { 'User-Agent': 'Mozilla/5.0' } })
                if (audioRes.data && audioRes.data.byteLength > 1000) {
                    return { buffer: Buffer.from(audioRes.data), title: meta.title || title, url: meta.url || url, duration: meta.timestamp || duration, thumbnail: meta.thumbnail || thumbnail }
                }
            }
        }
    } catch (e) { console.error('[play:vreden]', e?.message || e) }
    try {
        const ytsMod = (await import('yt-search')).default
        const search = await ytsMod(query)
        const video = search.videos?.[0]
        if (!video) throw new Error('No results found on YouTube')
        title = video.title; url = video.url; duration = video.timestamp || ''; thumbnail = video.thumbnail || ''
        const endpoints = [
            `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(url)}`,
            `https://yt.vreden.web.id/audio?url=${encodeURIComponent(url)}`,
            `https://apis.davidcyriltech.my.id/download/ytmp3?url=${encodeURIComponent(url)}`
        ]
        function pickUrl(data) {
            if (!data) return null
            if (typeof data === 'string' && data.startsWith('http')) return data
            const paths = [data?.data?.download, data?.data?.url, data?.data?.link, data?.result?.download, data?.result?.url, data?.result?.link, data?.result?.audio, data?.url, data?.download, data?.link, data?.mp3]
            for (const p of paths) { if (typeof p === 'string' && p.startsWith('http')) return p }
            return null
        }
        for (const ep of endpoints) {
            try {
                const { data } = await axios.get(ep, { timeout: 35000, headers: { 'User-Agent': 'Mozilla/5.0' } })
                const audioUrl = pickUrl(data)
                if (!audioUrl) continue
                const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 20 * 1024 * 1024, headers: { 'User-Agent': 'Mozilla/5.0' } })
                if (audioRes.data && audioRes.data.byteLength > 1000) {
                    return { buffer: Buffer.from(audioRes.data), title, url, duration, thumbnail }
                }
            } catch {}
        }
    } catch (e) { console.error('[play:fallback]', e?.message || e) }
    throw new Error('Download failed. Try another song or again later.')
}

export function parseTelegramStickerLink(input) {
    if (!input) return null
    let s = String(input).trim()
    let m = s.match(/(?:https?:\/\/)?t\.me\/addstickers\/([A-Za-z0-9_]+)/i)
    if (m) return m[1]
    m = s.match(/addstickers\/([A-Za-z0-9_]+)/i)
    if (m) return m[1]
    m = s.match(/^([A-Za-z0-9_]+)$/)
    if (m) return m[1]
    try {
        const u = new URL(s.startsWith('http') ? s : 'https://' + s)
        const parts = u.pathname.split('/').filter(Boolean)
        const last = parts[parts.length - 1]
        if (last && /^[A-Za-z0-9_]+$/.test(last) && last.toLowerCase() !== 'addstickers') return last
    } catch {}
    return null
}

function getTelegramToken() {
    const candidates = [process.env.TELEGRAM_BOT_TOKEN, process.env.TG_BOT_TOKEN, process.env.BOT_TOKEN, process.env.TELEGRAM_TOKEN, process.env.TG_TOKEN]
    for (const c of candidates) {
        const t = String(c || '').trim().replace(/^["']|["']$/g, '')
        if (t && t.includes(':')) return t
    }
    try {
        const settingsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'settings.json')
        if (fs.existsSync(settingsPath)) {
            const j = fs.readJsonSync(settingsPath)
            const t = String(j?.telegramToken || '').trim().replace(/^["']|["']$/g, '')
            if (t && t.includes(':')) { process.env.TELEGRAM_BOT_TOKEN = t; return t }
        }
    } catch {}
    try {
        const f = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'tg_token.txt')
        if (fs.existsSync(f)) {
            const t = String(fs.readFileSync(f, 'utf8')).trim().replace(/^["']|["']$/g, '')
            if (t && t.includes(':')) { process.env.TELEGRAM_BOT_TOKEN = t; return t }
        }
    } catch {}
    return ''
}

export async function getTelegramStickerSet(shortName) {
    const token = getTelegramToken()
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and add the token to env.')
    const url = `https://api.telegram.org/bot${token}/getStickerSet?name=${encodeURIComponent(shortName)}`
    const { data } = await axios.get(url, { timeout: 20000 })
    if (!data.ok) throw new Error(data.description || 'Failed to get sticker set (invalid name or private?)')
    return data.result
}

export async function downloadTelegramFile(fileId) {
    const token = getTelegramToken()
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
    const { data: fileInfo } = await axios.get(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, { timeout: 15000 })
    if (!fileInfo.ok || !fileInfo.result?.file_path) throw new Error('Could not resolve file path')
    const filePath = fileInfo.result.file_path
    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`
    const res = await axios.get(fileUrl, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 5 * 1024 * 1024 })
    return { buffer: Buffer.from(res.data), path: filePath, isAnimated: filePath.endsWith('.tgs') || filePath.endsWith('.webm'), isVideo: filePath.endsWith('.webm') }
}

export async function fetchTelegramStickers(shortName, limit = 0) {
    const set = await getTelegramStickerSet(shortName)
    const stickers = set.stickers || []
    const results = []
    let skipped = 0
    const list = (!limit || limit <= 0) ? stickers : stickers.slice(0, limit)
    for (const st of list) {
        try {
            const file = await downloadTelegramFile(st.file_id)
            if (file.path.endsWith('.tgs')) { skipped++; continue }
            results.push({ buffer: file.buffer, emoji: st.emoji || '⭐', isAnimated: !!st.is_animated || !!st.is_video, isVideo: !!st.is_video })
        } catch { skipped++ }
    }
    return { name: set.name, title: set.title, stickers: results, total: stickers.length, skipped }
}

const OTAKU_BASE = 'https://otakudesu.cloud'

export async function scrapeOtakudesuHome() {
    const { data } = await axios.get(OTAKU_BASE, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 15000 })
    const cheerio = await import('cheerio')
    const $ = cheerio.load(data)
    const results = []
    $('.venz > ul > li').each((_, el) => {
        const title = $(el).find('.jdlflm').text().trim()
        const episode = $(el).find('.epz').text().trim()
        const releaseDate = $(el).find('.epztipe').text().trim()
        const link = $(el).find('a').attr('href')
        const thumb = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || ''
        if (title && link) results.push({ title, episode, releaseDate, link, thumb })
    })
    return results
}

export async function searchOtakudesu(query) {
    const q = encodeURIComponent(String(query || '').trim())
    if (!q) return []
    const url = `${OTAKU_BASE}?s=${q}&post_type=anime`
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 15000 })
    const cheerio = await import('cheerio')
    const $ = cheerio.load(data)
    const results = []
    $('.chivsrc li, .venz ul li, ul.chivsrc > li').each((_, el) => {
        const title = $(el).find('h2 a, .jdlflm, a').first().text().trim()
        const link = $(el).find('h2 a, a').first().attr('href')
        const genres = $(el).find('.set').first().text().trim()
        const status = $(el).find('.set').eq(1).text().trim()
        const rating = $(el).find('.set').eq(2).text().trim()
        const thumb = $(el).find('img').attr('src') || ''
        if (title && link) results.push({ title, link, genres, status, rating, thumb })
    })
    if (!results.length) {
        $('a').each((_, el) => {
            const href = $(el).attr('href') || ''
            const title = $(el).text().trim()
            if (href.includes('/anime/') && title.length > 2) results.push({ title, link: href, genres: '', status: '', rating: '', thumb: '' })
        })
    }
    const seen = new Set()
    return results.filter(r => { if (seen.has(r.link)) return false; seen.add(r.link); return true }).slice(0, 15)
}
