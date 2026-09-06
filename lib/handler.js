import { writeFileSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.join(__dirname, '.handler.cache.js')

function ensure() {
  if (existsSync(CACHE)) return CACHE
  const a = readFileSync(path.join(__dirname, 'handler.part1.txt'), 'utf8')
  const b = readFileSync(path.join(__dirname, 'handler.part2.txt'), 'utf8')
  writeFileSync(CACHE, a + b)
  return CACHE
}

const mod = await import(pathToFileURL(ensure()).href)
export const handleMessage = mod.handleMessage
export const handleGroupParticipantsUpdate = mod.handleGroupParticipantsUpdate
