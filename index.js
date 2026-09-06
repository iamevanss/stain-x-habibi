/**
 * Bootstrap - auto-installs dependencies if missing, then starts the bot.
 * Works on panels that only run `node index.js` and block custom startup commands.
 */
import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const marker = path.join(__dirname, 'node_modules', '@whiskeysockets', 'baileys')

function needInstall() {
    return !existsSync(marker)
}

if (needInstall()) {
    console.log('')
    console.log('══════════════════════════════════════')
    console.log('  Dependencies not found.')
    console.log('  Running: npm install --legacy-peer-deps')
    console.log('  (This only happens once)')
    console.log('══════════════════════════════════════')
    console.log('')
    try {
        execSync('npm install --legacy-peer-deps', {
            stdio: 'inherit',
            cwd: __dirname,
            env: process.env,
            timeout: 300000 // 5 minutes max
        })
        console.log('')
        console.log('✅ Install finished. Starting bot...')
        console.log('')
    } catch (err) {
        console.error('')
        console.error('❌ npm install failed.')
        console.error('Try running in console: npm install --legacy-peer-deps')
        console.error(err.message || err)
        process.exit(1)
    }
}

// Load the real bot (after modules are present)
await import('./bot.js')
