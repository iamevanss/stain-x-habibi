# Stain × Habibi

**WhatsApp Multi-Device bot** for groups and private chats.

Manage groups, play media, make stickers, run owner tools.

## What it does

- **Group tools** — kick, promote, warn, antilink, tag all, open/close, and more
- **Media** — play audio, stickers, lyrics, TTS, Telegram sticker packs
- **Owner controls** — sudo, private/public mode, broadcast
- **Works in DMs and groups** on WhatsApp Multi-Device

## Requirements

- Node.js 18+
- FFmpeg on the host (for media)
- A valid WhatsApp session (`auth_info_baileys`) from the official pairing service

## Start

```bash
npm install --legacy-peer-deps
npm start
```

Or on panels that only run `node index.js`, the bootstrap installs dependencies once, then starts the bot.

## Config

Optional env (or `.env` for private/local use only — never commit it):

- `OWNER_NUMBER` — owner phone (digits). If empty, the paired bot number is used.
- `PREFIX` — command prefix (default `.`)
- `BOT_NAME` — display name
- `TELEGRAM_BOT_TOKEN` — only for optional `.tg` sticker packs

## License

[Proprietary — All Rights Reserved](./LICENSE)
