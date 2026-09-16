# Stain × Habibi

**WhatsApp Multi-Device bot** for groups and private chats.

Manage groups, play media, make stickers, run owner tools, and pair directly from the deployment console.

## What it does

- **Group tools** - kick, promote, warn, antilink, tag all, open/close, and more
- **Media** - play audio, stickers, lyrics, TTS, Telegram sticker packs
- **Owner controls** - sudo, private/public mode, broadcast
- **Local WhatsApp pairing** - no external pairing website is required
- **Persistent sessions** - the WhatsApp session is saved inside the bot installation
- **Works in DMs and groups** on WhatsApp Multi-Device

## Requirements

- Node.js 18+
- FFmpeg on the host (for media)
- A panel or host that can run `node index.js`

## Deployment

The public entry point is **`index.js`**.

If your panel starts the bot with `node index.js`, simply upload/clone the repository and start it.

The bootstrap will:

1. Check whether dependencies are installed.
2. Install them automatically if they are missing.
3. Check for an existing WhatsApp session.
4. If no session exists, ask for your WhatsApp phone number in the deployment console.
5. Generate a WhatsApp pairing code.
6. Save the resulting session locally in `auth_info_baileys/`.
7. Start Stain × Habibi.

### First deployment

Run:

```bash
node index.js
```

You will see:

```text
════════════════════════════════════════════
  WhatsApp pairing
════════════════════════════════════════════

Enter your WhatsApp phone number with country code.
Example: 2348012345678
Do not include +, spaces or dashes.

Phone number:
```

Enter the WhatsApp number you want to connect, then the bootstrap will display a pairing code.

On WhatsApp, open **Linked Devices → Link a Device** and complete the pairing using the displayed code.

After WhatsApp confirms the connection, the session is stored in:

```text
./auth_info_baileys/
```

The next time the panel restarts the bot, the saved session is detected automatically and the bot starts without asking for the number again.

## Important: `index.js`

**Yes - the file users run is `index.js`, and `index.js` contains the public bootstrap script.**

Users do **not** need to create a separate bootstrap file.

The deployment command is simply:

```bash
node index.js
```

or, where supported:

```bash
npm start
```

## Panel environment option

If a hosting panel does not provide an interactive console, the phone number can be supplied as an environment variable:

```env
PHONE_NUMBER=2348012345678
```

The number must include the country code and contain digits only.

## Config

Optional environment variables:

- `PHONE_NUMBER` - WhatsApp number used for first-time pairing when an interactive console is unavailable.
- `OWNER_NUMBER` - owner phone (digits). If empty, the paired bot number is used.
- `PREFIX` - command prefix (default `.`)
- `BOT_NAME` - display name
- `TELEGRAM_BOT_TOKEN` - only for optional `.tg` sticker packs

## Session storage

The Baileys authentication state is stored locally under:

```text
./auth_info_baileys/
```

Keep this directory private. Do not upload it to a public repository or share its contents. It is ignored by `.gitignore`.

## License

[Proprietary - All Rights Reserved](./LICENSE)
