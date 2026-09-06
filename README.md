# Stain × Habibi

WhatsApp Multi-Device bot built around the Stain × Habibi command structure.

## Public release

**Stain × Habibi no longer uses Telegram or terminal commands for WhatsApp pairing.**

The public release flow is:

1. Visit the official Stain × Habibi website.
2. Read the bot details, release information, features and requirements.
3. Tap **Pair Now**.
4. Complete WhatsApp pairing on the dedicated pairing page.
5. The pairing service creates the user's secure session and generates their personal bootstrap.
6. Deploy the generated bootstrap on the user's hosting/panel.
7. The bootstrap restores the user's session and starts the bot.

The bot repository itself must never contain a user's WhatsApp session, pairing code, `.env`, API secrets, or private credentials.

## Included

- Original General / Group / Media / Owner menu structure and styling
- Advanced welcome/goodbye configuration
- Warning and moderation controls
- Antilink, antiword, antispam, antigstatus, antigm, antipromote, antidemote, antibot and antidelete controls
- Scheduling and persistent per-group message statistics
- Per-group chatbot controls
- AFK and automatic replies/filters
- Group administration and join-request tools
- Media conversion and TTS/sticker utilities
- Social URL downloading and optional auto-download
- AI, search, image generation and summarization tools
- Weather, translation, dictionary, calculator, QR, URL shortening, crypto and news utilities
- Owner update/plugin controls
- LID/phone JID resolution support
- Telegram sticker-pack downloading through the Telegram Bot API (`.tg`) as an optional media utility

## Games

WCG / Word Chain, Tic-Tac-Toe, slots and other additional games are intentionally removed for now and can be reintroduced later as a separate professional games module.

## Configuration

Copy `.env.example` to `.env` for local/private development only.

Never commit:
- `.env`
- WhatsApp auth state
- session databases
- pairing secrets
- API keys
- Telegram bot tokens
- generated user bootstraps containing private configuration

`TELEGRAM_BOT_TOKEN` is **not** a pairing credential. It is only used by the optional `.tg` Telegram sticker-pack utility.

## Runtime requirements

- Node.js 18+
- FFmpeg installed on the host for media conversion
- A valid Stain × Habibi bootstrap/session generated through the public pairing service

## Start

```bash
npm install
npm start
```

## Repository architecture

```text
Public website
    │
    └── Pair Now
          │
          ▼
Vercel
    ├── Official landing page
    └── Dedicated pairing page / frontend
          │
          ▼
Oracle Cloud backend
    ├── WhatsApp pairing
    ├── Pairing-code generation
    ├── Session/bootstrap orchestration
    └── API / background pairing worker
          │
          ▼
Supabase
    ├── Protected persistent session storage
    ├── Simple public session IDs
    └── Session status + metadata
          │
          ▼
User hosting / panel
    │
    └── index.js / generated bootstrap
          │
          ▼
Stain × Habibi bot runtime
```

The public GitHub repository contains the reusable bot source. Vercel hosts the web frontend only. Oracle Cloud hosts the long-running pairing backend/worker. Supabase provides protected persistent session storage and exposes only the session information needed by the public flow. User sessions and private deployment data never belong in the public repository.
