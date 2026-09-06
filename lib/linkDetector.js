const URL_RE=/\b(?:https?:\/\/|www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,63})+)(?:\/[^\s]*)?/ig
export function detectLinks(text=''){return [...String(text).matchAll(URL_RE)].map(m=>m[0])}
export function normalizeHost(url){try{return new URL(/^https?:\/\//i.test(url)?url:`https://${url}`).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}}
export function isAllowedLink(url,allowed=[]){const h=normalizeHost(url);return allowed.some(x=>h===String(x).toLowerCase().replace(/^www\./,'')||h.endsWith(`.${String(x).toLowerCase().replace(/^www\./,'')}`))}
