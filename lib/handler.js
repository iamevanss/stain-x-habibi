import { writeFileSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.join(__dirname, '.handler.cache.js')

function ensure() {
  if (existsSync(CACHE)) return CACHE
  const parts = ['handler.part1.txt','handler.part2.txt','handler.part3.txt','handler.part4.txt']
  const code = parts.map(f => readFileSync(path.join(__dirname, f), 'utf8')).join('')
  writeFileSync(CACHE, code)
  return CACHE
}

const mod = await import(pathToFileURL(ensure()).href)
export const handleMessage = mod.handleMessage
export const handleGroupParticipantsUpdate = mod.handleGroupParticipantsUpdate
