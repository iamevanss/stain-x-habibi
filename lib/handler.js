import {
    jidNormalizedUser,
    isJidGroup,
    downloadContentFromMessage,
    getContentType
} from '@whiskeysockets/baileys'
import {
    isOwner,
    getOwner,
    isSudo,
    isOwnerOrSudo,
    addSudo,
    removeSudo,
    getSudoList,
    getMode,
    setMode,
    cleanNumber,
    getWarns,
    addWarn,
    resetWarn,
    resetAllWarns,
    getSetting,
    setSetting,
    getAntilinkMode,
    setAntilinkMode,
    isAntigstatus,
    setAntigstatus,
    setStoredTelegramToken,
    getStoredTelegramToken
} from './store.js'
import fs from 'fs-extra'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const startTime = Date.now()

function cleanJid(jid) {
    if (!jid) return ''
    return jidNormalizedUser(jid).split('@')[0]
}

function toJid(number) {
    const n = String(number).replace(/\D/g, '')
    return `${n}@s.whatsapp.net`
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    return `${h}h ${m}m ${sec}s`
}

async function getGroupMeta(sock, jid, helpers, force = false) {
    if (!force) {
        const cached = helpers.getCachedGroupMetadata?.(jid)
        if (cached) return cached
    }
    try {
        const meta = await sock.groupMetadata(jid)
        helpers.setCachedGroupMetadata?.(jid, meta)
        return meta
    } catch (e) {
        console.error('[groupMeta]', e?.message || e)
        return null
    }
}

function sameUser(a, b) {
    if (!a || !b) return false
    const na = jidNormalizedUser(String(a))
    const nb = jidNormalizedUser(String(b))
    if (na === nb) return true
    const da = cleanNumber(na)
    const db = cleanNumber(nb)
    if (da && db && (da === db || da.endsWith(db) || db.endsWith(da))) return true
    if (na.split('@')[0] === nb.split('@')[0]) return true
    return false
}

function isAdminFlag(p) {
    if (!p) return false
    const a = p.admin
    return a === 'admin' || a === 'superadmin' || a === true
}

async function isGroupAdmin(sock, groupJid, participantJid, helpers) {
    let meta = await getGroupMeta(sock, groupJid, helpers, true)
    if (!meta?.participants?.length) {
        meta = await getGroupMeta(sock, groupJid, helpers, true)
    }
    if (!meta?.participants?.length) return false

    const target = jidNormalizedUser(participantJid)
    const targetNum = cleanNumber(target)

    for (const p of meta.participants) {
        if (!isAdminFlag(p)) continue
        if (sameUser(p.id, target)) return true
        if (p.phoneNumber && sameUser(p.phoneNumber, target)) return true
        if (p.jid && sameUser(p.jid, target)) return true
        if (p.lid && sameUser(p.lid, target)) return true
        if (targetNum && cleanNumber(p.id) === targetNum) return true
    }
    return false
}

async function isBotAdmin(sock, groupJid, helpers) {
    const candidates = []
    if (sock.user?.id) candidates.push(sock.user.id)
    if (sock.user?.lid) candidates.push(sock.user.lid)
    if (sock.user?.id) {
        const n = cleanNumber(sock.user.id)
        if (n) candidates.push(n + '@s.whatsapp.net')
    }

    const meta = await getGroupMeta(sock, groupJid, helpers, true)
    if (!meta?.participants?.length) return false

    for (const cand of candidates) {
        for (const p of meta.participants) {
            if (!isAdminFlag(p)) continue
            if (sameUser(p.id, cand)) return true
            if (p.phoneNumber && sameUser(p.phoneNumber, cand)) return true
            if (p.jid && sameUser(p.jid, cand)) return true
            if (p.lid && sameUser(p.lid, cand)) return true
            const cn = cleanNumber(cand)
            if (cn && cleanNumber(p.id) === cn) return true
        }
    }

    const botNum = cleanNumber(sock.user?.id || '')
    if (botNum) {
        for (const p of meta.participants) {
            if (isAdminFlag(p) && cleanNumber(p.id) === botNum) return true
        }
    }
    return false
}

function getMentionedOrQuoted(msg, text) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo
    const out = []
    const mentioned = ctx?.mentionedJid || []
    for (const m of mentioned) out.push(jidNormalizedUser(m))
    if (ctx?.participant) out.push(jidNormalizedUser(ctx.participant))
    const match = String(text || '').match(/(\d{10,15})/g) || []
    for (const n of match) out.push(toJid(n))
    return [...new Set(out.filter(Boolean))]
}

async function resolveParticipant(sock, groupJid, targetJid, helpers) {
    const meta = await getGroupMeta(sock, groupJid, helpers, true)
    const target = jidNormalizedUser(targetJid)
    const targetNum = cleanNumber(target)
    if (!meta?.participants?.length) {
        return { jid: target, display: cleanJid(target) }
    }
    for (const p of meta.participants) {
        const ids = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean).map(jidNormalizedUser)
        for (const id of ids) {
            if (sameUser(id, target)) {
                const phone = cleanNumber(p.phoneNumber || p.id)
                const display = (phone && phone.length >= 10 && phone.length <= 15) ? phone : cleanJid(p.id)
                return { jid: p.id, display }
            }
        }
        if (targetNum && cleanNumber(p.id) === targetNum) {
            return { jid: p.id, display: targetNum }
        }
    }
    return { jid: target, display: cleanJid(target) }
}

async function sendText(sock, jid, text, quoted = null) {
    const opts = { text }
    if (quoted) opts.quoted = quoted
    return sock.sendMessage(jid, opts)
}

async function reply(sock, msg, text) {
    return sendText(sock, msg.key.remoteJid, text, msg)
}

const commands = {
    ping: {
        desc: 'Check bot response',
        async run(sock, msg) {
            const start = Date.now()
            const sent = await reply(sock, msg, '🏓 Pong...')
            const latency = Date.now() - start
            await sock.sendMessage(msg.key.remoteJid, {
                text: `🏓 *Pong!*\nLatency: ${latency}ms`,
                edit: sent.key
            }).catch(() => reply(sock, msg, `🏓 *Pong!*\nLatency: ${latency}ms`))
        }
    },

    menu: {
        aliases: ['list'],
        desc: 'Show organized command menu',
        alwaysPublic: true,
        async run(sock, msg, { botName, prefix }) {
            const own = getOwner() || 'Not Set'
            const mode = getMode()
            const start = Date.now()
            const speed = (Date.now() - start + Math.random()).toFixed(4)
            const mem = process.memoryUsage()
            const usedMb = (mem.heapUsed / 1024 / 1024).toFixed(0)
            const cmdCount = Object.keys(commands).length

            const header = `┏▣ ◈ *${botName}* ◈
┃ *ᴏᴡɴᴇʀ* : ${own}
┃ *ᴘʀᴇғɪx* : [ ${prefix} ]
┃ *ʜᴏsᴛ* : Panel
┃ *ᴄᴏᴍᴍᴀɴᴅs* : ${cmdCount}
┃ *ᴍᴏᴅᴇ* : ${mode === 'private' ? 'Private' : 'Public'}
┃ *ᴠᴇʀsɪᴏɴ* : 1.0.0
┃ *sᴘᴇᴇᴅ* : ${speed} ms
┃ *ʀᴀᴍ* : ${usedMb} MB
┗▣`

            const general = `┏▣ ◈ *GENERAL* ◈
│◇ ${prefix}ping
│◇ ${prefix}menu
│◇ ${prefix}help
│◇ ${prefix}owner
│◇ ${prefix}runtime
│◇ ${prefix}info
│◇ ${prefix}say
┗▣`

            const group = `┏▣ ◈ *GROUP* ◈
│◇ ${prefix}kick
│◇ ${prefix}promote
│◇ ${prefix}demote
│◇ ${prefix}tagall
│◇ ${prefix}hidetag
│◇ ${prefix}open
│◇ ${prefix}close
│◇ ${prefix}setname
│◇ ${prefix}setdesc
│◇ ${prefix}link
│◇ ${prefix}revoke
│◇ ${prefix}warn
│◇ ${prefix}warnings
│◇ ${prefix}resetwarn
│◇ ${prefix}resetallwarns
│◇ ${prefix}delete
│◇ ${prefix}admins
│◇ ${prefix}groupinfo
│◇ ${prefix}antilink
│◇ ${prefix}antigstatus
│◇ ${prefix}tkick
│◇ ${prefix}welcome
│◇ ${prefix}leave
┗▣`

            const media = `┏▣ ◈ *MEDIA* ◈
│◇ ${prefix}play
│◇ ${prefix}sticker
│◇ ${prefix}toimg
│◇ ${prefix}lyrics
│◇ ${prefix}tts
│◇ ${prefix}tg
│◇ ${prefix}gstatus
│◇ ${prefix}tostatus
│◇ ${prefix}anime
│◇ ${prefix}animesearch
│◇ ${prefix}alexa
│◇ ${prefix}couple
│◇ ${prefix}checkme
┗▣`

            const ownerM = `┏▣ ◈ *OWNER* ◈
│◇ ${prefix}join
│◇ ${prefix}broadcast
│◇ ${prefix}block
│◇ ${prefix}unblock
│◇ ${prefix}setprefix
│◇ ${prefix}setsudo
│◇ ${prefix}delsudo
│◇ ${prefix}listsudo
│◇ ${prefix}private
│◇ ${prefix}public
┗▣`

            await reply(sock, msg, [header, general, group, media, ownerM].join('\n\n'))
        }
    },

    help: {
        aliases: ['allcmds'],
        desc: 'Show all commands with descriptions',
        alwaysPublic: true,
        async run(sock, msg, { botName, prefix }) {
            const lines = [`┏▣ ◈ *${botName} — HELP* ◈`, `┃ Prefix: ${prefix}`, `┗▣`, '']
            const cats = {
                'GENERAL': ['ping', 'menu', 'help', 'owner', 'runtime', 'info', 'say'],
                'GROUP': ['kick', 'promote', 'demote', 'tagall', 'hidetag', 'open', 'close', 'setname', 'setdesc', 'link', 'revoke', 'warn', 'warnings', 'resetwarn', 'resetallwarns', 'delete', 'admins', 'groupinfo', 'antilink', 'antigstatus', 'tkick', 'welcome', 'leave'],
                'MEDIA': ['play', 'sticker', 'toimg', 'lyrics', 'tts', 'tg', 'gstatus', 'tostatus', 'anime', 'animesearch', 'alexa', 'couple', 'checkme'],
                'OWNER': ['join', 'broadcast', 'block', 'unblock', 'setprefix', 'setsudo', 'delsudo', 'listsudo', 'private', 'public']
            }
            for (const [cat, names] of Object.entries(cats)) {
                lines.push(`┏▣ ◈ *${cat}* ◈`)
                for (const n of names) {
                    const cmd = commands[n]
                    if (!cmd) continue
                    lines.push(`│◇ *${prefix}${n}* — ${cmd.desc || ''}`)
                }
                lines.push('┗▣', '')
            }
            await reply(sock, msg, lines.join('\n').trim())
        }
    },

    owner: {
        desc: 'Show bot owner',
        async run(sock, msg) {
            const own = getOwner()
            if (!own) return reply(sock, msg, 'Owner not set yet.')
            await sock.sendMessage(msg.key.remoteJid, {
                text: `👑 *Owner*\nwa.me/${own}`,
                mentions: [toJid(own)]
            }, { quoted: msg })
        }
    },

    runtime: {
        aliases: ['uptime'],
        desc: 'Bot uptime',
        async run(sock, msg, { botName }) {
            await reply(sock, msg, `⏱ *${botName}*\nUptime: ${formatUptime(Date.now() - startTime)}`)
        }
    },

    info: {
        aliases: ['botinfo'],
        desc: 'Bot information',
        async run(sock, msg, { botName, prefix }) {
            const own = getOwner()
            await reply(
                sock,
                msg,
                `*${botName}*\n\n• Prefix: ${prefix}\n• Owner: ${own || '—'}\n• Uptime: ${formatUptime(Date.now() - startTime)}\n• Mode: Multi-Device\n• Library: @whiskeysockets/baileys`
            )
        }
    },

    groupinfo: {
        aliases: ['ginfo', 'infogroup'],
        desc: 'Group information',
        groupOnly: true,
        async run(sock, msg, helpers) {
            const jid = msg.key.remoteJid
            const meta = await getGroupMeta(sock, jid, helpers)
            if (!meta) return reply(sock, msg, 'Could not fetch group info.')
            const admins = meta.participants?.filter((p) => p.admin).length || 0
            const text = `
*Group Info*
• Name: ${meta.subject}
• ID: ${meta.id}
• Members: ${meta.participants?.length || 0}
• Admins: ${admins}
• Created: ${meta.creation ? new Date(meta.creation * 1000).toLocaleString() : '—'}
• Desc: ${meta.desc || '—'}
`.trim()
            await reply(sock, msg, text)
        }
    },

    kick: {
        aliases: ['remove'],
        desc: 'Remove member from group',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag or reply to the user to kick.')
            const jid = msg.key.remoteJid
            for (const t of targets) {
                if (isOwner(t)) {
                    await reply(sock, msg, 'Cannot kick the owner.')
                    continue
                }
                try {
                    const { jid: real, display } = await resolveParticipant(sock, jid, t, helpers)
                    await sock.groupParticipantsUpdate(jid, [real], 'remove')
                    await sock.sendMessage(jid, {
                        text: `✅ Removed @${display}`,
                        mentions: [real]
                    }, { quoted: msg })
                } catch (e) {
                    await reply(sock, msg, `Failed to remove: ${e.message}`)
                }
            }
        }
    },

    promote: {
        desc: 'Promote member to admin',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag or reply to the user to promote.')
            const jid = msg.key.remoteJid
            for (const t of targets) {
                try {
                    const { jid: real, display } = await resolveParticipant(sock, jid, t, helpers)
                    await sock.groupParticipantsUpdate(jid, [real], 'promote')
                    await sock.sendMessage(jid, {
                        text: `✅ Promoted @${display}`,
                        mentions: [real]
                    }, { quoted: msg })
                } catch (e) {
                    await reply(sock, msg, `Failed: ${e.message}`)
                }
            }
        }
    },

    demote: {
        desc: 'Demote admin to member',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag or reply to the user to demote.')
            const jid = msg.key.remoteJid
            for (const t of targets) {
                if (isOwner(t)) {
                    await reply(sock, msg, 'Cannot demote the owner.')
                    continue
                }
                try {
                    const { jid: real, display } = await resolveParticipant(sock, jid, t, helpers)
                    await sock.groupParticipantsUpdate(jid, [real], 'demote')
                    await sock.sendMessage(jid, {
                        text: `✅ Demoted @${display}`,
                        mentions: [real]
                    }, { quoted: msg })
                } catch (e) {
                    await reply(sock, msg, `Failed: ${e.message}`)
                }
            }
        }
    },

    tagall: {
        aliases: ['mentionall', 'everyone'],
        desc: 'Mention all members',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const meta = await getGroupMeta(sock, msg.key.remoteJid, helpers)
            if (!meta) return reply(sock, msg, 'Could not fetch members.')
            const text = args.join(' ') || '📢 Attention everyone!'
            const mentions = meta.participants.map((p) => p.id)
            const body = mentions.map((m) => `@${cleanJid(m)}`).join('\n')
            await sock.sendMessage(msg.key.remoteJid, {
                text: `${text}\n\n${body}`,
                mentions
            }, { quoted: msg })
        }
    },

    hidetag: {
        aliases: ['htag'],
        desc: 'Hidden tag all members',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const meta = await getGroupMeta(sock, msg.key.remoteJid, helpers)
            if (!meta) return reply(sock, msg, 'Could not fetch members.')
            const text = args.join(' ') || '📢'
            const mentions = meta.participants.map((p) => p.id)
            await sock.sendMessage(msg.key.remoteJid, {
                text,
                mentions
            }, { quoted: msg })
        }
    },

    open: {
        aliases: ['groupopen', 'unmute'],
        desc: 'Open group (all can send)',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg) {
            await sock.groupSettingUpdate(msg.key.remoteJid, 'not_announcement')
            await reply(sock, msg, '✅ Group opened — everyone can send messages.')
        }
    },

    close: {
        aliases: ['groupclose', 'mute'],
        desc: 'Close group (only admins)',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg) {
            await sock.groupSettingUpdate(msg.key.remoteJid, 'announcement')
            await reply(sock, msg, '🔒 Group closed — only admins can send messages.')
        }
    },

    setname: {
        aliases: ['gname', 'setsubject'],
        desc: 'Change group name',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg, helpers, args) {
            const name = args.join(' ')
            if (!name) return reply(sock, msg, 'Provide a new group name.')
            await sock.groupUpdateSubject(msg.key.remoteJid, name)
            await reply(sock, msg, `✅ Group name changed to: *${name}*`)
        }
    },

    setdesc: {
        aliases: ['gdesc', 'setdescription'],
        desc: 'Change group description',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg, helpers, args) {
            const desc = args.join(' ')
            if (!desc) return reply(sock, msg, 'Provide a new description.')
            await sock.groupUpdateDescription(msg.key.remoteJid, desc)
            await reply(sock, msg, `✅ Group description updated.`)
        }
    },

    link: {
        aliases: ['invite', 'grouplink'],
        desc: 'Get group invite link',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg) {
            try {
                const code = await sock.groupInviteCode(msg.key.remoteJid)
                await reply(sock, msg, `🔗 *Group Link*\nhttps://chat.whatsapp.com/${code}`)
            } catch (e) {
                await reply(sock, msg, `Failed to get link: ${e.message}`)
            }
        }
    },

    revoke: {
        aliases: ['resetlink', 'revokelink'],
        desc: 'Revoke group invite link',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg) {
            try {
                await sock.groupRevokeInvite(msg.key.remoteJid)
                await reply(sock, msg, '✅ Group invite link has been revoked.')
            } catch (e) {
                await reply(sock, msg, `Failed: ${e.message}`)
            }
        }
    },

    warn: {
        desc: 'Warn a member',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag or reply to the user to warn.')
            const jid = msg.key.remoteJid
            for (const t of targets) {
                if (isOwner(t)) {
                    await reply(sock, msg, 'Cannot warn the owner.')
                    continue
                }
                const count = addWarn(jid, cleanJid(t))
                await reply(sock, msg, `⚠️ Warned @${cleanJid(t)}\nWarnings: ${count}/3`)
                if (count >= 3) {
                    try {
                        await sock.groupParticipantsUpdate(jid, [t], 'remove')
                        resetWarn(jid, cleanJid(t))
                        await reply(sock, msg, `🚫 @${cleanJid(t)} removed after 3 warnings.`)
                    } catch {
                        await reply(sock, msg, 'Reached 3 warns but could not remove (bot not admin?).')
                    }
                }
            }
        }
    },

    warnings: {
        aliases: ['warns'],
        desc: 'Check warnings of a user',
        groupOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            const jid = msg.key.remoteJid
            if (!targets.length) {
                const count = getWarns(jid, cleanJid(msg.key.participant || msg.key.remoteJid))
                return reply(sock, msg, `You have *${count}* warning(s).`)
            }
            for (const t of targets) {
                const count = getWarns(jid, cleanJid(t))
                await reply(sock, msg, `@${cleanJid(t)} has *${count}* warning(s).`)
            }
        }
    },

    resetwarn: {
        aliases: ['unwarn', 'delwarn'],
        desc: 'Reset warnings of a user',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag or reply to the user.')
            const jid = msg.key.remoteJid
            for (const t of targets) {
                resetWarn(jid, cleanJid(t))
                await reply(sock, msg, `✅ Warnings reset for @${cleanJid(t)}`)
            }
        }
    },

    resetallwarns: {
        desc: 'Reset all warnings in group',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg) {
            resetAllWarns(msg.key.remoteJid)
            await reply(sock, msg, '✅ All warnings in this group have been reset.')
        }
    },

    delete: {
        aliases: ['del', 'd'],
        desc: 'Delete a message (reply)',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg) {
            const ctx = msg.message?.extendedTextMessage?.contextInfo
            if (!ctx?.stanzaId) return reply(sock, msg, 'Reply to the message you want to delete.')
            try {
                await sock.sendMessage(msg.key.remoteJid, {
                    delete: {
                        remoteJid: msg.key.remoteJid,
                        fromMe: false,
                        id: ctx.stanzaId,
                        participant: ctx.participant
                    }
                })
            } catch (e) {
                await reply(sock, msg, `Failed to delete: ${e.message}`)
            }
        }
    },

    leave: {
        aliases: ['leavegroup'],
        desc: 'Bot leaves the group',
        groupOnly: true,
        ownerOnly: true,
        async run(sock, msg) {
            await reply(sock, msg, '👋 Leaving group...')
            await sock.groupLeave(msg.key.remoteJid)
        }
    },

    join: {
        desc: 'Join group via invite link (owner)',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            const link = args[0]
            if (!link || !link.includes('chat.whatsapp.com')) {
                return reply(sock, msg, 'Provide a valid group invite link.')
            }
            const code = link.split('chat.whatsapp.com/')[1]?.split(/[?#]/)[0]
            if (!code) return reply(sock, msg, 'Invalid link.')
            try {
                const res = await sock.groupAcceptInvite(code)
                await reply(sock, msg, `✅ Joined group: ${res}`)
            } catch (e) {
                await reply(sock, msg, `Failed to join: ${e.message}`)
            }
        }
    },

    broadcast: {
        aliases: ['bc'],
        desc: 'Broadcast message to all groups (owner)',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            const text = args.join(' ')
            if (!text) return reply(sock, msg, 'Provide a message to broadcast.')
            const groups = Object.keys(await sock.groupFetchAllParticipating().catch(() => ({})))
            let ok = 0
            for (const g of groups) {
                try {
                    await sock.sendMessage(g, { text: `📢 *Broadcast*\n\n${text}` })
                    ok++
                    await new Promise((r) => setTimeout(r, 1500))
                } catch {}
            }
            await reply(sock, msg, `✅ Broadcast sent to ${ok}/${groups.length} groups.`)
        }
    },

    antilink: {
        desc: 'Antilink mode: off / delete / warn / kick',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const jid = msg.key.remoteJid
            const arg = (args[0] || '').toLowerCase()
            if (['off', 'delete', 'warn', 'kick'].includes(arg)) {
                setAntilinkMode(jid, arg)
                await reply(sock, msg, `✅ Antilink mode: *${arg.toUpperCase()}*`)
                return
            }
            if (arg === 'on') {
                setAntilinkMode(jid, 'delete')
                await reply(sock, msg, '✅ Antilink mode: *DELETE*')
                return
            }
            const mode = getAntilinkMode(jid)
            await reply(sock, msg,
`*Antilink*
Current: *${mode.toUpperCase()}*

Usage:
\`.antilink off\` — disabled
\`.antilink delete\` — delete link messages
\`.antilink warn\` — delete + warn (3 warns = kick)
\`.antilink kick\` — delete + remove member`)
        }
    },

    antigstatus: {
        aliases: ['antigroupstatus'],
        desc: 'Kick non-admins who post group status',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const jid = msg.key.remoteJid
            const arg = (args[0] || '').toLowerCase()
            if (arg === 'on') {
                setAntigstatus(jid, true)
                await reply(sock, msg, '✅ *Antigstatus ON*\nNon-admins who post group status will be removed.')
            } else if (arg === 'off') {
                setAntigstatus(jid, false)
                await reply(sock, msg, '✅ *Antigstatus OFF*')
            } else {
                const on = isAntigstatus(jid)
                await reply(sock, msg, `Antigstatus: *${on ? 'ON' : 'OFF'}*\nUsage: .antigstatus on/off`)
            }
        }
    },

    welcome: {
        desc: 'Toggle welcome messages (on/off)',
        groupOnly: true,
        adminOnly: true,
        async run(sock, msg, helpers, args) {
            const jid = msg.key.remoteJid
            const arg = (args[0] || '').toLowerCase()
            if (arg === 'on') {
                setSetting('welcome', jid, true)
                await reply(sock, msg, '✅ Welcome messages *enabled*.')
            } else if (arg === 'off') {
                setSetting('welcome', jid, false)
                await reply(sock, msg, '✅ Welcome messages *disabled*.')
            } else {
                const state = getSetting('welcome', jid) ? 'ON' : 'OFF'
                await reply(sock, msg, `Welcome is currently *${state}*\nUsage: .welcome on/off`)
            }
        }
    },

    admins: {
        aliases: ['listadmin'],
        desc: 'List group admins',
        groupOnly: true,
        async run(sock, msg, helpers) {
            const meta = await getGroupMeta(sock, msg.key.remoteJid, helpers)
            if (!meta) return reply(sock, msg, 'Could not fetch group.')
            const admins = meta.participants.filter((p) => p.admin)
            const text = admins.map((a, i) => `${i + 1}. @${cleanJid(a.id)}`).join('\n')
            await sock.sendMessage(msg.key.remoteJid, {
                text: `👑 *Admins*\n\n${text}`,
                mentions: admins.map((a) => a.id)
            }, { quoted: msg })
        }
    },

    block: {
        desc: 'Block a user (owner)',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag/reply/number to block.')
            for (const t of targets) {
                await sock.updateBlockStatus(t, 'block')
                await reply(sock, msg, `🚫 Blocked @${cleanJid(t)}`)
            }
        }
    },

    unblock: {
        desc: 'Unblock a user (owner)',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) return reply(sock, msg, 'Tag/reply/number to unblock.')
            for (const t of targets) {
                await sock.updateBlockStatus(t, 'unblock')
                await reply(sock, msg, `✅ Unblocked @${cleanJid(t)}`)
            }
        }
    },

    setprefix: {
        desc: 'Change command prefix (owner)',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            if (!args[0]) return reply(sock, msg, 'Provide new prefix character.')
            helpers.prefix = args[0]
            await reply(sock, msg, `✅ Prefix temporarily set to: ${args[0]}\n(Restart + env PREFIX for permanent)`)
        }
    },

    say: {
        aliases: ['echo'],
        desc: 'Make bot say something',
        async run(sock, msg, helpers, args) {
            const text = args.join(' ')
            if (!text) return reply(sock, msg, 'What should I say?')
            await sendText(sock, msg.key.remoteJid, text)
        }
    },

    setsudo: {
        aliases: ['addsudo'],
        desc: 'Add a sudo user (owner only)',
        trueOwnerOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) {
                return reply(sock, msg, 'Tag / reply / number to add as sudo.\nExample: .setsudo @user')
            }
            const added = []
            for (const t of targets) {
                const num = cleanJid(t)
                if (isOwner(num)) {
                    await reply(sock, msg, `@${num} is already the main owner.`)
                    continue
                }
                if (addSudo(num)) {
                    added.push(num)
                } else {
                    await reply(sock, msg, `@${num} is already a sudo.`)
                }
            }
            if (added.length) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `✅ Sudo added:\n${added.map(n => `• @${n}`).join('\n')}`,
                    mentions: added.map(n => toJid(n))
                }, { quoted: msg })
            }
        }
    },

    delsudo: {
        aliases: ['remsudo', 'removesudo'],
        desc: 'Remove a sudo user (owner only)',
        trueOwnerOnly: true,
        async run(sock, msg, helpers, args) {
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) {
                return reply(sock, msg, 'Tag / reply / number to remove from sudo.\nExample: .delsudo @user')
            }
            const removed = []
            for (const t of targets) {
                const num = cleanJid(t)
                if (removeSudo(num)) {
                    removed.push(num)
                } else {
                    await reply(sock, msg, `@${num} is not a sudo.`)
                }
            }
            if (removed.length) {
                await sock.sendMessage(msg.key.remoteJid, {
                    text: `✅ Sudo removed:\n${removed.map(n => `• @${n}`).join('\n')}`,
                    mentions: removed.map(n => toJid(n))
                }, { quoted: msg })
            }
        }
    },

    listsudo: {
        aliases: ['sudolist', 'getsudo'],
        desc: 'List all sudo users',
        ownerOnly: true,
        async run(sock, msg) {
            const list = getSudoList()
            const own = getOwner()
            if (!list.length) {
                return reply(sock, msg, `👑 Owner: ${own || '—'}\n\nNo sudo users yet.\nUse .setsudo @user to add.`)
            }
            const text = `👑 *Owner:* ${own || '—'}\n\n⚡ *Sudo list (${list.length})*\n` +
                list.map((n, i) => `${i + 1}. @${n}`).join('\n')
            await sock.sendMessage(msg.key.remoteJid, {
                text,
                mentions: list.map(n => toJid(n))
            }, { quoted: msg })
        }
    },

    gstatus: {
        aliases: ['groupstatus', 'gs'],
        desc: 'Post to group status (reply media/text). From DM: .gstatus <groupJid>',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            const jid = msg.key.remoteJid
            const isGroup = isJidGroup(jid)
            let targetGroup = null
            let textArgs = args

            if (isGroup) {
                targetGroup = jid
            } else {
                const maybe = (args[0] || '').trim()
                if (!maybe || !maybe.includes('@g.us')) {
                    return reply(sock, msg,
`*Group Status*

In a group:
• Reply to image/video/sticker/text with \`.gstatus\`
• Or \`.gstatus Hello\`

From DM (no admin needed):
• \`.gstatus 120363...@g.us\` (reply to media)
• \`.gstatus 120363...@g.us Hello text\`

Get group id: open group → .groupinfo`)
                }
                targetGroup = maybe.includes('@') ? maybe : `${maybe}@g.us`
                textArgs = args.slice(1)
            }

            const ctx = msg.message?.extendedTextMessage?.contextInfo
            const quoted = ctx?.quotedMessage
            const caption = textArgs.join(' ').trim()

            try {
                let content = null

                if (quoted) {
                    const qType = Object.keys(quoted).find(k => k.endsWith('Message') || k === 'conversation')
                    if (quoted.imageMessage || quoted.viewOnceMessage?.message?.imageMessage || quoted.viewOnceMessageV2?.message?.imageMessage) {
                        const { downloadMediaMsg } = await import('./media.js')
                        const targetMsg = { message: quoted.viewOnceMessage?.message || quoted.viewOnceMessageV2?.message || quoted, key: msg.key }
                        const { buffer } = await downloadMediaMsg(targetMsg)
                        content = { image: buffer, caption: caption || quoted.imageMessage?.caption || '' }
                    } else if (quoted.videoMessage) {
                        const { downloadMediaMsg } = await import('./media.js')
                        const { buffer } = await downloadMediaMsg({ message: quoted, key: msg.key })
                        content = { video: buffer, caption: caption || quoted.videoMessage?.caption || '' }
                    } else if (quoted.stickerMessage) {
                        const { downloadMediaMsg } = await import('./media.js')
                        const { buffer } = await downloadMediaMsg({ message: quoted, key: msg.key })
                        content = { sticker: buffer }
                    } else if (quoted.conversation || quoted.extendedTextMessage) {
                        const t = quoted.conversation || quoted.extendedTextMessage?.text || caption
                        content = { text: t || caption }
                    } else if (quoted.audioMessage) {
                        const { downloadMediaMsg } = await import('./media.js')
                        const { buffer } = await downloadMediaMsg({ message: quoted, key: msg.key })
                        content = { audio: buffer, mimetype: quoted.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: true }
                    }
                }

                if (!content) {
                    if (!caption) {
                        return reply(sock, msg, 'Reply to an image/video/sticker/text, or provide text.\nExample: .gstatus Hello')
                    }
                    content = { text: caption }
                }

                let sent = false
                let lastErr = null
                const errors = []

                if (!sent) {
                    try {
                        await sock.sendMessage(targetGroup, { ...content, groupStatus: true })
                        sent = true
                    } catch (e) {
                        errors.push('groupStatus:' + (e?.message || e))
                        lastErr = e
                    }
                }

                if (!sent) {
                    try {
                        await sock.sendMessage(targetGroup, { groupStatusMessage: content })
                        sent = true
                    } catch (e) {
                        errors.push('groupStatusMessage:' + (e?.message || e))
                        lastErr = e
                    }
                }

                if (!sent) {
                    try {
                        await sock.sendMessage(targetGroup, {
                            groupStatusMessageV2: content
                        })
                        sent = true
                    } catch (e) {
                        errors.push('groupStatusMessageV2:' + (e?.message || e))
                        lastErr = e
                    }
                }

                if (!sent && typeof sock.sendGroupStatus === 'function') {
                    try {
                        await sock.sendGroupStatus(targetGroup, content)
                        sent = true
                    } catch (e) {
                        errors.push('sendGroupStatus:' + (e?.message || e))
                        lastErr = e
                    }
                }

                if (!sent) {
                    try {
                        await sock.sendMessage(targetGroup, content, { groupStatus: true })
                        sent = true
                    } catch (e) {
                        errors.push('opts.groupStatus:' + (e?.message || e))
                        lastErr = e
                    }
                }

                if (sent) {
                    await reply(sock, msg, `✅ Posted to *group status*\nGroup: ${targetGroup}`)
                } else {
                    console.error('[gstatus] all methods failed', errors)
                    await reply(sock, msg, `❌ Group status failed (not posted as chat).\n${lastErr?.message || errors.join(' | ') || 'Unknown'}`)
                }
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    tostatus: {
        aliases: ['status', 'story'],
        desc: 'Post to your personal WhatsApp status (reply media/text)',
        ownerOnly: true,
        async run(sock, msg, helpers, args) {
            const caption = args.join(' ').trim()
            const ctx = msg.message?.extendedTextMessage?.contextInfo
            const quoted = ctx?.quotedMessage

            try {
                let statusJidList = []
                try {
                    if (isJidGroup(msg.key.remoteJid)) {
                        const meta = await getGroupMeta(sock, msg.key.remoteJid, helpers, true)
                        statusJidList = (meta?.participants || []).map(p => p.id).filter(Boolean).slice(0, 500)
                    }
                } catch {}

                let content = null
                if (quoted?.imageMessage) {
                    const { downloadMediaMsg } = await import('./media.js')
                    const { buffer } = await downloadMediaMsg({ message: quoted, key: msg.key })
                    content = { image: buffer, caption: caption || '' }
                } else if (quoted?.videoMessage) {
                    const { downloadMediaMsg } = await import('./media.js')
                    const { buffer } = await downloadMediaMsg({ message: quoted, key: msg.key })
                    content = { video: buffer, caption: caption || '' }
                } else if (quoted?.stickerMessage) {
                    const { downloadMediaMsg } = await import('./media.js')
                    const { buffer } = await downloadMediaMsg({ message: quoted, key: msg.key })
                    content = { sticker: buffer }
                } else if (caption || quoted?.conversation || quoted?.extendedTextMessage) {
                    content = {
                        text: caption || quoted?.conversation || quoted?.extendedTextMessage?.text || 'Status'
                    }
                }

                if (!content) {
                    return reply(sock, msg, 'Reply to image/video/sticker or use:\n.tostatus Your text')
                }

                await sock.sendMessage(
                    'status@broadcast',
                    content,
                    {
                        backgroundColor: '#111111',
                        font: 0,
                        statusJidList: statusJidList.length ? statusJidList : undefined,
                        broadcast: true
                    }
                )
                await reply(sock, msg, '✅ Posted to your *personal status*')
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    settgtoken: {
        aliases: ['telegramtoken', 'settgtoken'],
        desc: 'Save Telegram bot token (owner) — use if env is ignored',
        trueOwnerOnly: true,
        async run(sock, msg, helpers, args) {
            const tok = args.join(' ').trim()
            if (!tok || !tok.includes(':')) {
                return reply(sock, msg, 'Usage: .settgtoken 123456:ABC-DEF...\nGet token from @BotFather')
            }
            setStoredTelegramToken(tok)
            process.env.TELEGRAM_BOT_TOKEN = tok
            try {
                const fs = (await import('fs-extra')).default
                const path = (await import('path')).default
                const { fileURLToPath } = await import('url')
                const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
                fs.ensureDirSync(dir)
                fs.writeFileSync(path.join(dir, 'tg_token.txt'), tok, 'utf8')
            } catch {}
            await reply(sock, msg, '✅ Telegram token saved.\nTry: .tg THE_EYES')
        }
    },

    private: {
        aliases: ['self'],
        desc: 'Private mode — only owner & sudo can use bot',
        trueOwnerOnly: true,
        async run(sock, msg) {
            setMode('private')
            await reply(sock, msg, '🔒 *Private mode ON*\nOnly owner & sudo can use commands now.')
        }
    },

    public: {
        aliases: ['modepublic'],
        desc: 'Public mode — everyone can use bot',
        trueOwnerOnly: true,
        async run(sock, msg) {
            setMode('public')
            await reply(sock, msg, '🌐 *Public mode ON*\nEveryone can use commands now.')
        }
    },

    couple: {
        aliases: ['coupledps', 'ppcp'],
        desc: 'Random couple profile pictures',
        async run(sock, msg) {
            try {
                const axios = (await import('axios')).default
                const { data } = await axios.get(
                    'https://gist.githubusercontent.com/ayazaliofc/58f731507d834f61b9b6f6b950804a7a/raw',
                    { timeout: 15000 }
                )
                const result = data?.result || data
                if (!Array.isArray(result) || !result.length) {
                    return reply(sock, msg, 'No couple pics available right now.')
                }
                const pick = result[Math.floor(Math.random() * result.length)]
                if (pick.male) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: pick.male },
                        caption: '𝐌𝐀𝐋𝐄 🤍'
                    }, { quoted: msg })
                }
                if (pick.female) {
                    await sock.sendMessage(msg.key.remoteJid, {
                        image: { url: pick.female },
                        caption: '𝐅𝐄𝐌𝐀𝐋𝐄 🌸'
                    }, { quoted: msg })
                }
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    checkme: {
        aliases: ['aboutme', 'whoami'],
        desc: 'Fun random profile about you',
        async run(sock, msg, helpers, args) {
            const characteristics = ['Annoying','Charming','Funny','Serious','Smart','Courageous','Loyal','Adventurous','Creative','Generous','Kind','Honest','Ambitious','Friendly','Dependable','Optimistic','Pessimistic','Curious','Independent']
            const hobbies = ['Singing','Dancing','Reading','Gaming','Cooking','Traveling','Painting','Writing','Swimming','Hiking','Cycling','Fishing','Photography','Gardening','Drawing','Running','Meditating']
            const handsome = ['Very Ugly','Average','Handsome','Very Handsome','Not Bad','Stunning','Plain','Gorgeous','Unattractive','Attractive','Radiant','Decent','Cute','Dashing','Charming','Ordinary','Beautiful']
            const characters = ['Patient','Impulsive','Calm','Energetic','Thoughtful','Reckless','Wise','Nervous','Confident','Determined','Practical','Emotional','Logical','Carefree','Serene','Ambitious','Gentle','Bold','Tolerant']
            const pick = (a) => a[Math.floor(Math.random() * a.length)]
            const pct = () => Math.floor(Math.random() * 101)
            const name = msg.pushName || args.join(' ') || 'User'
            const text = `*CHECKING ${name}*

*NAME :* ${name}
*CHARACTERISTIC :* ${pick(characteristics)}
*HOBBY :* ${pick(hobbies)}
*SIMP :* ${pct()}%
*GREAT :* ${pct()}%
*HANDSOME :* ${pick(handsome)}
*CHARACTER :* ${pick(characters)}
*GOOD MORALS :* ${pct()}%
*BAD MORALS :* ${pct()}%
*INTELLIGENCE :* ${pct()}%
*COURAGE :* ${pct()}%
*AFRAID :* ${pct()}%

*ALL ABOUT YOU 🤍*`
            await reply(sock, msg, text)
        }
    },

    alexa: {
        aliases: ['music', 'sonu'],
        desc: 'Play music via Sayan API (fast audio)',
        async run(sock, msg, helpers, args) {
            const q = args.join(' ').trim()
            if (!q) return reply(sock, msg, 'Example: .alexa Teri Ishq Main')
            try {
                await reply(sock, msg, `🎧 Searching *${q}*...`)
                const axios = (await import('axios')).default
                const api = `https://api.sayan-nexuswork.workers.dev/music?query=${encodeURIComponent(q)}`
                const { data } = await axios.get(api, { timeout: 30000 })
                if (data.status !== 'success' || !data.url) {
                    return reply(sock, msg, 'No results. Try another song.')
                }
                const title = (data.title || q).split(/\s+/).slice(0, 12).join(' ')
                const caption = `☘️ *Title:* ${title}
⏱️ *Duration:* ${data.duration || '-'}
🎭 *Views:* ${data.views || '-'}
📺 *Channel:* ${data.channel || '-'}
🎙️ *API:* ${data.creator || 'sayan'}`
                if (data.thumbnail) {
                    try {
                        await sock.sendMessage(msg.key.remoteJid, {
                            image: { url: data.thumbnail },
                            caption
                        }, { quoted: msg })
                    } catch {
                        await reply(sock, msg, caption)
                    }
                } else {
                    await reply(sock, msg, caption)
                }
                const audioRes = await axios.get(data.url, {
                    responseType: 'arraybuffer',
                    timeout: 120000,
                    maxContentLength: 20 * 1024 * 1024,
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Referer': 'https://m.youtube.com/'
                    }
                })
                const buffer = Buffer.from(audioRes.data)
                if (!buffer.length) return reply(sock, msg, 'Audio buffer empty.')
                await sock.sendMessage(msg.key.remoteJid, {
                    audio: buffer,
                    mimetype: 'audio/mpeg',
                    fileName: `${title}.mp3`,
                    ptt: false
                }, { quoted: msg })
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    tkick: {
        aliases: ['tempkick', 'tk'],
        desc: 'Temp kick — removes user, re-adds after 5 minutes',
        groupOnly: true,
        adminOnly: true,
        botAdmin: true,
        async run(sock, msg, helpers, args) {
            const jid = msg.key.remoteJid
            const targets = getMentionedOrQuoted(msg, args.join(' '))
            if (!targets.length) {
                return reply(sock, msg, 'Tag or reply to the user.\nUsage: .tkick @user')
            }
            for (const t of targets) {
                try {
                    if (isOwner(t)) {
                        await reply(sock, msg, 'Cannot tkick the owner.')
                        continue
                    }
                    const { jid: real, display } = await resolveParticipant(sock, jid, t, helpers)
                    if (await isGroupAdmin(sock, jid, real, helpers)) {
                        await sock.sendMessage(jid, {
                            text: `❌ Cannot tkick admin @${display}`,
                            mentions: [real]
                        }, { quoted: msg })
                        continue
                    }
                    await sock.sendMessage(jid, {
                        text: `@${display} will be removed.\nRe-added in *5 minutes*.`,
                        mentions: [real]
                    }, { quoted: msg })
                    await sock.groupParticipantsUpdate(jid, [real], 'remove')
                    setTimeout(async () => {
                        try {
                            await sock.groupParticipantsUpdate(jid, [real], 'add')
                            await sock.sendMessage(jid, {
                                text: `@${display} has been re-added.`,
                                mentions: [real]
                            })
                        } catch (e) {
                            try {
                                await sock.sendMessage(jid, {
                                    text: `Could not re-add @${display}: ${e.message}`,
                                    mentions: [real]
                                })
                            } catch {}
                        }
                    }, 5 * 60 * 1000)
                } catch (e) {
                    await reply(sock, msg, `Failed: ${e.message}`)
                }
            }
        }
    },

    anime: {
        aliases: ['otaku', 'otakudesu', 'animes'],
        desc: 'Latest anime releases from Otakudesu',
        async run(sock, msg, helpers, args) {
            try {
                await reply(sock, msg, '🎌 Fetching latest anime...')
                const { scrapeOtakudesuHome, searchOtakudesu } = await import('./media.js')
                const q = args.join(' ').trim()

                if (q) {
                    const list = await searchOtakudesu(q)
                    if (!list.length) return reply(sock, msg, `No results for: *${q}*`)
                    let text = `┏▣ ◈ *ANIME SEARCH* ◈\n┃ Query: ${q}\n┗▣\n\n`
                    list.slice(0, 12).forEach((a, i) => {
                        text += `*${i + 1}. ${a.title}*\n`
                        if (a.status) text += `   ${a.status}\n`
                        if (a.genres) text += `   ${a.genres}\n`
                        if (a.rating) text += `   ${a.rating}\n`
                        text += `   🔗 ${a.link}\n\n`
                    })
                    return reply(sock, msg, text.trim())
                }

                const list = await scrapeOtakudesuHome()
                if (!list.length) return reply(sock, msg, 'No anime found (site may be down).')
                let text = `┏▣ ◈ *LATEST ANIME* ◈\n┃ Source: Otakudesu\n┗▣\n\n`
                list.slice(0, 15).forEach((a, i) => {
                    text += `*${i + 1}. ${a.title}*\n`
                    if (a.episode) text += `   📺 ${a.episode}\n`
                    if (a.releaseDate) text += `   📅 ${a.releaseDate}\n`
                    text += `   🔗 ${a.link}\n\n`
                })
                text += `_Use .anime <name> to search_`
                await reply(sock, msg, text.trim())
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    animesearch: {
        aliases: ['searchanime', 'carikanime'],
        desc: 'Search anime on Otakudesu',
        async run(sock, msg, helpers, args) {
            const q = args.join(' ').trim()
            if (!q) return reply(sock, msg, 'Usage: .animesearch <title>')
            try {
                await reply(sock, msg, `🔍 Searching *${q}*...`)
                const { searchOtakudesu } = await import('./media.js')
                const list = await searchOtakudesu(q)
                if (!list.length) return reply(sock, msg, `No results for: *${q}*`)
                let text = `┏▣ ◈ *ANIME SEARCH* ◈\n┃ ${q}\n┗▣\n\n`
                list.slice(0, 12).forEach((a, i) => {
                    text += `*${i + 1}. ${a.title}*\n`
                    if (a.status) text += `   ${a.status}\n`
                    if (a.genres) text += `   ${a.genres}\n`
                    text += `   🔗 ${a.link}\n\n`
                })
                await reply(sock, msg, text.trim())
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    play: {
        aliases: ['song', 'ytmp3'],
        desc: 'Play / download YouTube audio (Sayan → Vreden → APIs)',
        async run(sock, msg, helpers, args) {
            const q = args.join(' ').trim()
            if (!q) return reply(sock, msg, 'Example: .play Blinding Lights')
            await reply(sock, msg, '🔍 Searching & downloading...')
            try {
                const { searchAndGetAudio } = await import('./media.js')
                const result = await searchAndGetAudio(q)
                const title = (result.title || q).slice(0, 60)
                const caption = `✅ *${title}*\n⏱️ ${result.duration || '-'}`
                if (result.thumbnail) {
                    try {
                        await sock.sendMessage(msg.key.remoteJid, {
                            image: { url: result.thumbnail },
                            caption
                        }, { quoted: msg })
                    } catch {
                        await reply(sock, msg, caption)
                    }
                } else {
                    await reply(sock, msg, caption)
                }
                await sock.sendMessage(msg.key.remoteJid, {
                    audio: result.buffer,
                    mimetype: 'audio/mpeg',
                    ptt: false,
                    fileName: `${title.slice(0, 40)}.mp3`
                }, { quoted: msg })
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },
    sticker: {
        aliases: ['s', 'stiker'],
        desc: 'Convert image to sticker (reply to image)',
        async run(sock, msg) {
            const ctx = msg.message?.extendedTextMessage?.contextInfo
            const quoted = ctx?.quotedMessage
            const hasImage = !!msg.message?.imageMessage
            if (!quoted && !hasImage) {
                return reply(sock, msg, 'Reply to an image or send image with .sticker')
            }
            try {
                const { downloadMediaMsg, createSticker } = await import('./media.js')
                let targetMsg = msg
                if (quoted) {
                    targetMsg = {
                        message: quoted,
                        key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }
                    }
                }
                const { buffer } = await downloadMediaMsg(targetMsg)
                const stickerBuf = await createSticker(buffer)
                if (!stickerBuf || stickerBuf.length < 100 || stickerBuf[0] !== 0x52) {
                    throw new Error('Sticker encode failed (not WebP). Ensure sharp installed.')
                }
                await sock.sendMessage(msg.key.remoteJid, {
                    sticker: stickerBuf
                }, { quoted: msg })
            } catch (e) {
                await reply(sock, msg, `❌ Failed to create sticker: ${e.message}`)
            }
        }
    },

    toimg: {
        aliases: ['toimage', 'img'],
        desc: 'Convert sticker to image (reply to sticker)',
        async run(sock, msg) {
            const ctx = msg.message?.extendedTextMessage?.contextInfo
            const quoted = ctx?.quotedMessage
            if (!quoted?.stickerMessage) {
                return reply(sock, msg, 'Reply to a sticker with .toimg')
            }
            try {
                const { downloadMediaMsg, stickerToImage } = await import('./media.js')
                const targetMsg = {
                    message: quoted,
                    key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant }
                }
                const { buffer } = await downloadMediaMsg(targetMsg)
                const imgBuf = await stickerToImage(buffer)
                await sock.sendMessage(msg.key.remoteJid, {
                    image: imgBuf,
                    caption: '✅ Sticker → Image'
                }, { quoted: msg })
            } catch (e) {
                await reply(sock, msg, `❌ Failed: ${e.message}`)
            }
        }
    },

    lyrics: {
        aliases: ['lyric', 'lirik'],
        desc: 'Fetch song lyrics (lyrics.ovh)',
        async run(sock, msg, helpers, args) {
            const q = args.join(' ').trim()
            if (!q) return reply(sock, msg, 'Example: .lyrics shape of you')
            try {
                await reply(sock, msg, '📝 Searching lyrics...')
                const axios = (await import('axios')).default
                const suggest = await axios.get(`https://api.lyrics.ovh/suggest/${encodeURIComponent(q)}`, { timeout: 15000 })
                const song = suggest.data?.data?.[0]
                if (!song) return reply(sock, msg, 'No song found for that query.')
                const artist = song.artist?.name || 'Unknown'
                const title = song.title || q
                const lyr = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 20000 })
                let text = lyr.data?.lyrics
                if (!text) return reply(sock, msg, `No lyrics for *${title}* — ${artist}`)
                text = text.replace(/\n{4,}/g, '\n\n\n').replace(/\n{2}/g, '\n')
                const out = `*♪ ${title}*\n_${artist}_\n\n${text}`
                if (out.length > 4000) {
                    await reply(sock, msg, out.slice(0, 3900) + '\n\n_…truncated_')
                } else {
                    await reply(sock, msg, out)
                }
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    },

    tts: {
        aliases: ['speak'],
        desc: 'Text to speech',
        async run(sock, msg, helpers, args) {
            let lang = 'en'
            let text = args.join(' ')
            if (args[0] && args[0].length === 2 && args.length > 1) {
                lang = args[0].toLowerCase()
                text = args.slice(1).join(' ')
            }
            if (!text) return reply(sock, msg, 'Example: .tts Hello world\nor .tts es Hola mundo')
            try {
                const { textToSpeech } = await import('./media.js')
                const audio = await textToSpeech(text, lang)
                await sock.sendMessage(msg.key.remoteJid, {
                    audio,
                    mimetype: 'audio/mp4',
                    ptt: true
                }, { quoted: msg })
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    }

    ,

    tg: {
        aliases: ['telegram', 'tgsticker', 'tgs'],
        desc: 'Download Telegram sticker pack (plugin-style)',
        async run(sock, msg, helpers, args) {
            const input = args.join(' ').trim()
            if (!input) {
                return reply(sock, msg, `Usage:\n.tg https://t.me/addstickers/PackName\n.tg PackName\n\nRequires TELEGRAM_BOT_TOKEN in env.`)
            }
            try {
                const { parseTelegramStickerLink, fetchTelegramStickers, setStickerPack } = await import('./media.js')
                const shortName = parseTelegramStickerLink(input)
                if (!shortName) return reply(sock, msg, 'Invalid Telegram sticker link or name.')

                await reply(sock, msg, `📦 Fetching *${shortName}* ...`)
                const pack = await fetchTelegramStickers(shortName, 0) // 0 = ALL stickers

                if (!pack.stickers.length) {
                    return reply(sock, msg, `No compatible stickers (Lottie .tgs skipped).\nPack total: ${pack.total}`)
                }

                await reply(sock, msg, `✅ *${pack.title}*\nDownloading ${pack.stickers.length}/${pack.total} stickers...`)

                let sent = 0
                for (const st of pack.stickers) {
                    try {
                        let buf = st.buffer
                        const isWebp = st.isWebp || (buf && buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49)
                        if (!st.isVideo && !isWebp) {
                            try {
                                buf = await setStickerPack(buf, '𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶', '𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶')
                            } catch {}
                        } else if (!st.isVideo) {
                            try {
                                buf = await setStickerPack(buf, '𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶', '𝘏𝘢𝘣𝘪𝘣𝘪 𝘔𝘶𝘨𝘴 𝘠𝘰𝘶')
                            } catch {}
                        }
                        await sock.sendMessage(msg.key.remoteJid, {
                            sticker: buf
                        }, { quoted: msg })
                        sent++
                        await new Promise(r => setTimeout(r, 1000))
                    } catch (e) {
                        console.error('[tg] sticker fail', e?.message || e)
                    }
                }
                await reply(sock, msg, `✨ Done — *${pack.title}* (${sent} sent)`)
            } catch (e) {
                await reply(sock, msg, `❌ ${e.message}`)
            }
        }
    }
}

const aliasMap = {}
for (const [name, cmd] of Object.entries(commands)) {
    aliasMap[name] = name
    if (cmd.aliases) {
        for (const a of cmd.aliases) aliasMap[a] = name
    }
}

export async function handleMessage(sock, msg, helpers) {
    try {
        if (!msg.message) return
        if (msg.key.remoteJid === 'status@broadcast') return

        const jid = msg.key.remoteJid
        const isGroup = isJidGroup(jid)

        const candidates = []
        const push = (v) => { if (v) candidates.push(String(v)) }
        if (isGroup) {
            push(msg.key.participantPn)      // real phone when available
            push(msg.key.participantAlt)
            push(msg.key.participant)
            push(msg.participant)
        } else {
            push(msg.key.remoteJidAlt)
            push(msg.key.participantPn)
            push(msg.key.remoteJid)
        }
        if (msg.key.fromMe && sock.user?.id) push(sock.user.id)

        let rawSender = candidates[0] || jid
        for (const cand of candidates) {
            const n = cleanNumber(cand)
            if (n && n.length >= 10 && n.length <= 15 && !String(cand).includes('@lid')) {
                rawSender = cand
                break
            }
        }
        const sender = jidNormalizedUser(rawSender || jid)
        let senderNum = cleanNumber(sender)
        for (const cand of candidates) {
            const n = cleanNumber(cand)
            if (n && isOwner(n)) { senderNum = n; break }
            if (n && isSudo(n)) { senderNum = n; break }
        }

        const type = getContentType(msg.message)
        let body = ''
        if (type === 'conversation') body = msg.message.conversation
        else if (type === 'extendedTextMessage') body = msg.message.extendedTextMessage?.text || ''
        else if (type === 'imageMessage') body = msg.message.imageMessage?.caption || ''
        else if (type === 'videoMessage') body = msg.message.videoMessage?.caption || ''
        else body = ''

        body = (body || '').trim()
        if (!body) return

        const prefix = helpers.prefix || '.'

        if (msg.key.fromMe && !body.startsWith(prefix)) return

        if (isGroup && isAntigstatus(jid) && !msg.key.fromMe) {
            const m = msg.message || {}
            const isGStatus = !!(
                m.groupStatusMessage ||
                m.groupStatusMessageV2 ||
                m.messageContextInfo?.groupStatusMentionMessage ||
                m.protocolMessage?.type === 'GROUP_STATUS_MENTION_MESSAGE' ||
                (m.associatedChildMessage && m.groupStatusMessage) ||
                m.ephemeralMessage?.message?.groupStatusMessage ||
                m.viewOnceMessage?.message?.groupStatusMessage
            )
            const rawStr = JSON.stringify(m)
            const looksLikeGStatus = isGStatus || (
                rawStr.includes('groupStatus') ||
                rawStr.includes('GROUP_STATUS')
            )
            if (looksLikeGStatus && !isOwnerOrSudo(senderNum)) {
                const admin = await isGroupAdmin(sock, jid, sender, helpers)
                if (!admin) {
                    try {
                        if (await isBotAdmin(sock, jid, helpers)) {
                            try { await sock.sendMessage(jid, { delete: msg.key }) } catch {}
                            const victim = msg.key.participant || sender
                            await sock.groupParticipantsUpdate(jid, [victim], 'remove')
                            await reply(sock, msg, `🚫 Group status is admins-only.\n@${cleanJid(victim)} removed.`)
                        } else {
                            await reply(sock, msg, '🚫 Group status is admins-only (I need admin to remove).')
                        }
                    } catch (e) {
                        console.error('[antigstatus]', e.message)
                    }
                    return
                }
            }
        }

        if (isGroup) {
            const alMode = getAntilinkMode(jid)
            if (alMode !== 'off' && body) {
                const linkRegex = /https?:\/\/|wa\.me\/|chat\.whatsapp\.com\//i
                if (linkRegex.test(body) && !isOwnerOrSudo(senderNum)) {
                    const admin = await isGroupAdmin(sock, jid, sender, helpers)
                    if (!admin) {
                        const botAdm = await isBotAdmin(sock, jid, helpers)
                        try {
                            if (botAdm) {
                                try { await sock.sendMessage(jid, { delete: msg.key }) } catch {}
                            }
                            if (alMode === 'delete') {
                                await reply(sock, msg, '🔗 Links are not allowed here.')
                            } else if (alMode === 'warn') {
                                const count = addWarn(jid, senderNum || cleanJid(sender))
                                await reply(sock, msg, `🔗 Links not allowed.\n⚠️ Warning ${count}/3`)
                                if (count >= 3 && botAdm) {
                                    try {
                                        await sock.groupParticipantsUpdate(jid, [msg.key.participant || sender], 'remove')
                                        resetWarn(jid, senderNum || cleanJid(sender))
                                        await reply(sock, msg, '🚫 Removed after 3 warnings.')
                                    } catch {}
                                }
                            } else if (alMode === 'kick') {
                                await reply(sock, msg, '🔗 Links not allowed — removing...')
                                if (botAdm) {
                                    try {
                                        await sock.groupParticipantsUpdate(jid, [msg.key.participant || sender], 'remove')
                                    } catch (e) {
                                        await reply(sock, msg, `Kick failed: ${e.message}`)
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('[antilink]', e.message)
                        }
                        return
                    }
                }
            }
        }

        if (!body.startsWith(prefix)) return

        const withoutPrefix = body.slice(prefix.length).trim()
        const [cmdName, ...args] = withoutPrefix.split(/\s+/)
        const cmdKey = aliasMap[cmdName.toLowerCase()]
        if (!cmdKey) return

        const cmd = commands[cmdKey]
        if (!cmd) return

        const mode = getMode()
        if (mode === 'private' && !isOwnerOrSudo(senderNum) && !cmd.alwaysPublic) {
            return // silent ignore in private mode
        }

        if (cmd.groupOnly && !isGroup) {
            return reply(sock, msg, 'This command only works in groups.')
        }
        if (cmd.ownerOnly && !isOwnerOrSudo(senderNum)) {
            return reply(sock, msg, 'Owner / Sudo only command.')
        }
        if (cmd.trueOwnerOnly && !isOwner(senderNum)) {
            return reply(sock, msg, 'Only the main owner can use this.')
        }
        if (cmd.adminOnly && isGroup) {
            const admin = await isGroupAdmin(sock, jid, sender, helpers)
            if (!admin && !isOwnerOrSudo(senderNum)) {
                return reply(sock, msg, 'Admins only.')
            }
        }
        if (cmd.botAdmin && isGroup) {
            const botAdm = await isBotAdmin(sock, jid, helpers)
            if (!botAdm) {
                return reply(sock, msg, 'I need to be an admin to do that.')
            }
        }

        await cmd.run(sock, msg, helpers, args)
    } catch (err) {
        console.error('[handleMessage]', err)
    }
}

export async function handleGroupParticipantsUpdate(sock, update, { botName }) {
    try {
        const { id, participants, action } = update
        if (!id || !participants?.length) return

        if (action === 'add' && getSetting('welcome', id)) {
            for (const p of participants) {
                const num = cleanJid(p)
                await sock.sendMessage(id, {
                    text: `👋 Welcome @${num} to the group!\n\n_${botName}_`,
                    mentions: [p]
                })
            }
        }

        if (action === 'remove' && getSetting('welcome', id)) {
            for (const p of participants) {
                const num = cleanJid(p)
                await sock.sendMessage(id, {
                    text: `👋 @${num} left the group.`,
                    mentions: [p]
                })
            }
        }
    } catch (err) {
        console.error('[group-participants]', err.message)
    }
}