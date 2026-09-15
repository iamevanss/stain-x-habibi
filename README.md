# Stain × Habibi

**WhatsApp Multi-Device bot** for groups and private chats.

Manage groups, play media, make stickers, run owner tools, and use moderation features.

## Included

- **General** - ping, menu, help, owner, runtime, info, say
- **Group moderation** - kick, promote, demote, tagall, hidetag, open/close, warnings, delete, admins, antilink, antigstatus, welcome/leave
- **Media** - YouTube audio, stickers, sticker-to-image, lyrics, TTS, Telegram sticker packs, anime search, group status, personal status
- **Owner controls** - join, broadcast, block/unblock, prefix, sudo, private/public mode
- **WhatsApp Multi-Device** - uses the Stain custom Baileys fork

## Requirements

- Node.js 18+
- FFmpeg on the host for media features that require it
- A valid WhatsApp session (`auth_info_baileys`) obtained through the project's official pairing service

The public bot repository does **not** contain the pairing backend or session service. Those belong to the private deployment infrastructure.

## Start

```bash
npm install
npm start
```

For panels that only run `node index.js`, the bootstrap checks for dependencies, installs them when needed, and starts the bot.

## Configuration

Copy `.env.example` to `.env` for local/private use. Never commit real credentials.

- `OWNER_NUMBER` - owner phone number in digits. If empty, the paired bot number is used.
- `PREFIX` - command prefix, default `.`
- `BOT_NAME` - bot display name
- `TELEGRAM_BOT_TOKEN` - optional token used only by `.tg` Telegram sticker-pack support
- `COBALT_API_URL` - optional media endpoint override
- `COBALT_VIDEO_QUALITY` - optional media quality setting

## Session

Place the session files from the official pairing service in:

```text
auth_info_baileys/
```

Then restart the bot. Do not publish or share the contents of that directory.

## Panel deployment

The intended public deployment flow is:

1. Obtain a session through the official Stain pairing website.
2. Deploy this repository on your hosting panel.
3. Add your environment variables.
4. Place the generated session in `auth_info_baileys/` as instructed by the pairing service.
5. Start with `node index.js` or `npm start`.

## Development check

Run the local syntax check before committing changes:

```bash
npm run check
```

## License

[Proprietary - All Rights Reserved](./LICENSE)
