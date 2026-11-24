// lib/suggestParse.ts
// Validering og sikker lokal reparation af Claude-svar til tekstforslag.
// Ren logik uden netværk – bruges af /api/suggest og kan testes isoleret.

export const ELEMENTS = ['title', 'meta', 'h1', 'h2', 'intro', 'body', 'link'] as const
export const EVIDENCE = ['dokumenteret', 'hypotese', 'redaktionel'] as const

export interface ParsedSuggestion {
  element: string
  current: string
  proposed: string
  reason: string
  observation: string
  judgement: string
  evidence: string
  source: string
  placement: string
}

export interface ParsedSuggestions {
  behold: boolean
  beholdReason: string
  suggestions: ParsedSuggestion[]
  warnings: string[]
}

export type SuggestProblemKind = 'tomt' | 'afbrudt' | 'ugyldig-json' | 'manglende-felter' | 'afvist'

export type ParseOutcome =
  | { ok: true; data: ParsedSuggestions }
  | { ok: false; kind: SuggestProblemKind; message: string }

// JSON-schema til Claudes strukturerede output (output_config.format). Kun understøttede schema-features.
const SUGGESTION_PROPS = {
  element: { type: 'string', enum: [...ELEMENTS] },
  current: { type: 'string' },
  proposed: { type: 'string' },
  observation: { type: 'string' },
  judgement: { type: 'string' },
  evidence: { type: 'string', enum: [...EVIDENCE] },
  source: { type: 'string' },
  placement: { type: 'string' },
}
export const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    behold: { type: 'boolean' },
    beholdReason: { type: 'string' },
    suggestions: {
      type: 'array',
      items: { type: 'object', properties: SUGGESTION_PROPS, required: Object.keys(SUGGESTION_PROPS), additionalProperties: false },
    },
  },
  required: ['behold', 'beholdReason', 'suggestions'],
  additionalProperties: false,
}

// Fjerner nøgle-lignende strenge fra tekst, der vises eller logges
export function scrub(s: string): string {
  return String(s).replace(/sk-ant-[A-Za-z0-9_-]+/g, '[nøgle skjult]').replace(/x-api-key[^\n]*/gi, '[skjult]')
}

// Finder første JSON-objekt i teksten (efter evt. indledning/kodeblok). `complete` er false, hvis objektet er afkortet.
export function extractJsonBlock(text: string): { json: string; complete: boolean } | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return { json: text.slice(start, i + 1), complete: true } }
  }
  return { json: text.slice(start), complete: false }
}

// Sikre reparationer: rå linjeskift/tab i strenge og efterfølgende kommaer. Ændrer aldrig indholdet.
export function repairJson(s: string): string {
  let out = '', inStr = false, esc = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) { out += ch; esc = false; continue }
      if (ch === '\\') { out += ch; esc = true; continue }
      if (ch === '"') { inStr = false; out += ch; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
      continue
    }
    if (ch === '"') { inStr = true; out += ch; continue }
    if (ch === ',') {
      let j = i + 1
      while (j < s.length && /\s/.test(s[j])) j++
      if (s[j] === '}' || s[j] === ']') continue // efterfølgende komma
    }
    out += ch
  }
  return out
}

function tryParse(s: string): any | undefined {
  try { return JSON.parse(s) } catch { /* prøv reparation */ }
  try { return JSON.parse(repairJson(s)) } catch { return undefined }
}

// Fra et afkortet svar: bjærg kun fuldt afsluttede forslag-objekter
export function salvageTruncated(text: string): { behold?: boolean; beholdReason?: string; suggestions: any[] } | null {
  const idx = text.search(/"suggestions"\s*:\s*\[/)
  if (idx < 0) return null
  let i = text.indexOf('[', idx) + 1
  const items: any[] = []
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++
    if (text[i] !== '{') break
    const blk = extractJsonBlock(text.slice(i))
    if (!blk || !blk.complete) break
    const obj = tryParse(blk.json)
    if (obj && typeof obj === 'object') items.push(obj)
    i += blk.json.length
  }
  const b = text.match(/"behold"\s*:\s*(true|false)/)
  const r = text.match(/"beholdReason"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  return { behold: b ? b[1] === 'true' : undefined, beholdReason: r ? tryParse('"' + r[1] + '"') : undefined, suggestions: items }
}

function str(v: unknown): string { return typeof v === 'string' ? v : '' }

// Validerer et parset objekt og normaliserer det. Nul forslag er et gyldigt BEHOLD-svar.
export function validateSuggestions(obj: any, extraWarnings: string[] = []): ParseOutcome {
  const warnings = [...extraWarnings]
  let root = obj
  if (Array.isArray(root)) root = { suggestions: root }
  if (!root || typeof root !== 'object') return { ok: false, kind: 'manglende-felter', message: 'Svaret er ikke et JSON-objekt med forslag.' }
  const hasSug = Array.isArray(root.suggestions)
  const hasBehold = typeof root.behold === 'boolean'
  if (!hasSug && !hasBehold) return { ok: false, kind: 'manglende-felter', message: 'Svaret mangler både "suggestions" og "behold".' }
  const raw: any[] = hasSug ? root.suggestions : []
  const valid: ParsedSuggestion[] = []
  let dropped = 0
  for (const s of raw) {
    if (!s || typeof s !== 'object' || !ELEMENTS.includes(s.element) || !str(s.proposed).trim()) { dropped++; continue }
    const observation = str(s.observation)
    const judgement = str(s.judgement) || str(s.reason)
    valid.push({
      element: s.element,
      current: str(s.current),
      proposed: s.proposed,
      reason: judgement,
      observation,
      judgement,
      // "dokumenteret" kræver en faktisk observation og kan aldrig bruges om linkrelevans
      evidence: s.evidence === 'dokumenteret' && s.element !== 'link' && observation.trim() ? 'dokumenteret' : s.evidence === 'redaktionel' ? 'redaktionel' : 'hypotese',
      source: str(s.source),
      placement: str(s.placement),
    })
  }
  if (dropped > 0) warnings.push(`${dropped} forslag manglede påkrævede felter eller havde ukendt element og er udeladt.`)
  if (valid.length > 3) { warnings.push(`Claude gav ${valid.length} forslag – kun de tre første vises.`); valid.length = 3 }
  const suggestions = valid
  const behold = suggestions.length === 0
  const beholdReason = str(root.beholdReason) || (behold ? (dropped > 0 ? 'Ingen gyldige forslag i svaret.' : 'Claude foreslår ingen ændringer – eksisterende indhold bevares.') : '')
  if (behold && dropped > 0 && !hasBehold) return { ok: false, kind: 'manglende-felter', message: 'Alle forslag i svaret manglede påkrævede felter.' }
  return { ok: true, data: { behold, beholdReason, suggestions, warnings } }
}

export function parseSuggestionText(text: string, stopReason?: string | null): ParseOutcome {
  if (stopReason === 'refusal') return { ok: false, kind: 'afvist', message: 'Claude afviste at besvare forespørgslen.' }
  const t = (text || '').trim()
  if (!t) return { ok: false, kind: stopReason === 'max_tokens' ? 'afbrudt' : 'tomt', message: stopReason === 'max_tokens' ? 'Svaret blev afbrudt, før der kom indhold.' : 'Claude returnerede et tomt svar.' }
  const truncated = stopReason === 'max_tokens'
  const blk = extractJsonBlock(t)
  if (!blk) return { ok: false, kind: 'ugyldig-json', message: 'Svaret indeholder ikke JSON.' }
  if (blk.complete) {
    const parsed = tryParse(blk.json)
    if (parsed !== undefined) {
      const repaired = (() => { try { JSON.parse(blk.json); return false } catch { return true } })()
      return validateSuggestions(parsed, repaired ? ['Svarformatet blev rettet lokalt (fx linjeskift eller efterfølgende komma).'] : [])
    }
  }
  // Afkortet eller ikke-reparerbart: bjærg fuldt afsluttede forslag
  const salv = salvageTruncated(t)
  if (salv && salv.suggestions.length > 0) {
    return validateSuggestions({ behold: salv.behold, beholdReason: salv.beholdReason, suggestions: salv.suggestions },
      [truncated || !blk.complete ? 'Svaret blev afbrudt – kun fuldt færdige forslag vises.' : 'Svarformatet var delvist ugyldigt – kun læsbare forslag vises.'])
  }
  if (truncated || !blk.complete) return { ok: false, kind: 'afbrudt', message: 'Svaret blev afbrudt, før noget forslag var færdigt.' }
  return { ok: false, kind: 'ugyldig-json', message: 'Svaret er ikke gyldig JSON og kunne ikke repareres sikkert.' }
}
