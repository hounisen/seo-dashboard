// lib/overlap.ts
// URL-overlap og mulig kannibalisering ud fra GSC (forespørgsel × landingsside × periode) og Ahrefs (Previous/Current URL).
// Ren logik uden netværk. Konklusioner er altid foreløbige: sidernes indhold læses ikke her.

export interface GscPageRow { query: string; page: string; period: string; clicks: number; impressions: number; ctr: number | null; position: number | null }
export interface GscPageParse {
  rows: GscPageRow[]
  periods: string[]
  periodSource: 'kolonne' | 'kolonneoverskrift' | 'fane' | 'filtre' | 'filnavn' | 'ukendt'
  warnings: string[]
  dataRows?: number // læste forespørgsel-URL-rækker (én pr. række i filen, uanset antal perioder)
  skippedRows?: number // rækker uden forespørgsel/side
  pairs?: number // unikke forespørgsel × URL
}
export interface AhrefsUrlRow { keyword: string; volume: number | null; prevPos: number | null; currPos: number | null; prevUrl: string; currUrl: string; lastUrl: string; otherUrls: string[] }

type Cell = string | number | null | undefined
export interface SheetRaw { name: string; rows: Cell[][] }

const low = (c: Cell) => String(c ?? '').toLowerCase().trim()
const num = (v: Cell): number | null => {
  if (v == null || v === '') return null
  let s = String(v).replace('%', '').replace(/\s/g, '')
  s = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.')
  const n = Number(s)
  return isNaN(n) ? null : n
}
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim())

export function normUrl(u: string): string {
  let s = (u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/#.*$/, '')
  const qi = s.indexOf('?')
  if (qi >= 0) {
    // kun sporingsparametre fjernes; øvrige parametre kan skelne forskellige sider og bevares
    const keep = s.slice(qi + 1).split('&').filter(x => x && !/^(utm_|gclid|fbclid|srsltid|msclkid)/.test(x)).sort()
    s = s.slice(0, qi).replace(/\/+$/, '') + (keep.length ? '?' + keep.join('&') : '')
  } else s = s.replace(/\/+$/, '')
  try { s = decodeURIComponent(s) } catch { /* behold */ }
  return s
}

// ── GSC: forespørgsel × side ─────────────────────────────────────────────────
export interface PeriodDef { label: string; start: string; end: string; hint: 'ny' | 'tidligere' | '' }
export interface PeriodInfo {
  status: 'ok' | 'enkelt' | 'uklar'
  current: string | null
  previous: string | null
  periods: PeriodDef[]
  error?: string
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', maj: '05', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', okt: '10', oct: '10', nov: '11', dec: '12' }
const pad = (n: string | number) => String(n).padStart(2, '0')
// Finder datoer i en tekst (ISO, dd.mm.åååå, dd/mm/åååå, dd-mm-åååå, «26. aug. 2026», «Aug 26, 2026») og returnerer ISO-datoer i rækkefølge
export function parseDates(t: string): string[] {
  const found: { i: number; d: string }[] = []
  let m: RegExpExecArray | null
  const iso = /(\d{4})-(\d{2})-(\d{2})/g
  while ((m = iso.exec(t))) found.push({ i: m.index, d: `${m[1]}-${m[2]}-${m[3]}` })
  const dmy = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/g
  while ((m = dmy.exec(t))) found.push({ i: m.index, d: `${m[3]}-${pad(m[2])}-${pad(m[1])}` })
  const dmon = /(\d{1,2})\.?\s*(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)[a-zæø]*\.?,?\s*(\d{4})/gi
  while ((m = dmon.exec(t))) found.push({ i: m.index, d: `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${pad(m[1])}` })
  const mond = /(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)[a-zæø]*\.?\s*(\d{1,2}),?\s*(\d{4})/gi
  while ((m = mond.exec(t))) found.push({ i: m.index, d: `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${pad(m[2])}` })
  const seen: string[] = []
  return found.sort((x, y) => x.i - y.i).map(x => x.d).filter(d => (seen.indexOf(d) < 0 ? (seen.push(d), true) : false))
}
const hintOf = (t: string): 'ny' | 'tidligere' | '' =>
  /(forrige|foregående|tidligere|previous|prior|sammenlign)/i.test(t) ? 'tidligere' : /(seneste|sidste|nyeste|aktuel|current|latest|last\b|ny periode)/i.test(t) ? 'ny' : ''

// Entydig afgørelse af, hvilken periode der er den aktuelle. Gætter aldrig ud fra kolonneorden eller størrelse.
export function resolvePeriods(defs: PeriodDef[]): PeriodInfo {
  if (defs.length === 0) return { status: 'uklar', current: null, previous: null, periods: [], error: 'Ingen perioder kunne aflæses.' }
  if (defs.length === 1) return { status: 'enkelt', current: defs[0].label, previous: null, periods: defs }
  const dated = defs.filter(d => d.start && d.end)
  if (dated.length === defs.length) {
    const sorted = defs.slice().sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
    const [n, o] = sorted
    if (n.start <= o.end) return { status: 'uklar', current: null, previous: null, periods: defs, error: `Perioderne «${n.label}» og «${o.label}» overlapper – de kan ikke bruges som aktuel og tidligere periode.` }
    if (n.end === o.end) return { status: 'uklar', current: null, previous: null, periods: defs, error: 'To perioder har samme slutdato.' }
    const hn = hintOf(n.label), ho = hintOf(o.label)
    if ((hn === 'tidligere' && ho !== 'tidligere') || (ho === 'ny' && hn !== 'ny' && hn === '')) {
      return { status: 'uklar', current: null, previous: null, periods: defs, error: 'Datoerne og betegnelserne i kolonneoverskrifterne er modstridende.' }
    }
    return { status: 'ok', current: n.label, previous: o.label, periods: defs }
  }
  if (dated.length === 0 && defs.length === 2) {
    const [a, b] = defs
    if (a.hint && b.hint && a.hint !== b.hint) {
      const n = a.hint === 'ny' ? a : b, o = a.hint === 'ny' ? b : a
      return { status: 'ok', current: n.label, previous: o.label, periods: defs }
    }
  }
  return { status: 'uklar', current: null, previous: null, periods: defs, error: 'Perioderne kan ikke identificeres entydigt (datoer eller «seneste»/«forrige» mangler i overskrifterne). Performanceberegninger er stoppet, så en forkert periode ikke bruges som aktuel.' }
}

const METRIC = (h: string): 'clicks' | 'impressions' | 'ctr' | 'position' | null =>
  /\b(klik|clicks?)\b/.test(h) ? 'clicks' : /\b(eksponeringer|visninger|impressions?)\b/.test(h) ? 'impressions' : /\bctr\b/.test(h) ? 'ctr' : /\b(placering|position|average position)\b/.test(h) ? 'position' : null
const isDeltaHeader = (h: string) => /(difference|forskel|ændring|change|delta|diff\b)/.test(h)

function periodFromFilters(sheets: SheetRaw[]): string {
  const f = sheets.find(s => /^(filtre|filters?)$/i.test(s.name.trim()))
  if (!f) return ''
  for (const r of f.rows) {
    const a = low(r[0]), b = String(r[1] ?? '').trim()
    if (b && /^(dato|date|periode|period)/.test(a)) return b
  }
  return ''
}
function periodFromFileName(name: string): string {
  const m = name.match(/(\d{4}-\d{2}-\d{2})[^\d]{1,6}(\d{4}-\d{2}-\d{2})/)
  return m ? `${m[1]} – ${m[2]}` : ''
}

// Fjerner metrik-ord fra en overskrift, så kun periodebetegnelsen bliver tilbage
function periodLabelOf(text: string): string {
  let t = text.replace(/\b(klik|clicks?|eksponeringer|visninger|impressions?|ctr|placering|gennemsnitlig|position|average)\b/gi, ' ').replace(/\bgns\b\.?/gi, ' ').replace(/%/g, ' ')
  t = t.replace(/^[\s\-–—:(.]+|[\s\-–—:.]+$/g, '').replace(/\s+/g, ' ').trim()
  // afsluttende parentes fjernes kun, hvis den ikke har en åbnende modstykke
  if (t.endsWith(')') && (t.match(/\(/g) || []).length < (t.match(/\)/g) || []).length) t = t.slice(0, -1).trim()
  return /[A-Za-zÆØÅæøå0-9]/.test(t) ? t : ''
}
const defOf = (label: string): PeriodDef => { const d = parseDates(label); return { label, start: d.length >= 2 ? d.slice().sort()[0] : '', end: d.length >= 2 ? d.slice().sort()[d.length - 1] : '', hint: hintOf(label) } }

export function parseGscQueryPage(sheets: SheetRaw[], fileName = ''): (GscPageParse & { periodInfo: PeriodInfo }) | null {
  const warnings: string[] = []
  const rows: GscPageRow[] = []
  const defs: PeriodDef[] = []
  const addDef = (label: string) => { if (!defs.some(d => d.label === label)) defs.push(defOf(label)) }
  let source: GscPageParse['periodSource'] = 'ukendt'
  let dataRows = 0, skipped = 0, ctrMismatch = 0
  const pairSet: Record<string, true> = {}
  const deltaSamples: { metric: 'clicks' | 'impressions'; delta: number; vals: Record<string, number> }[] = []
  const filterPeriod = periodFromFilters(sheets)
  const namePeriod = periodFromFileName(fileName)
  const dataSheets = sheets.filter(s => !/^(filtre|filters?)$/i.test(s.name.trim()))
  const multiSheet = dataSheets.length > 1
  const Q = /forespørg|quer|søgeord|keyword/, PG = /landingsside|landing page|^side$|^page$|^sider$|top pages|^url$|mest anvendte sider/

  for (const sh of dataSheets) {
    const hdrIdx = sh.rows.slice(0, 6).findIndex(r => { const hs = (r || []).map(low); return hs.some(h => Q.test(h)) && hs.some(h => PG.test(h)) })
    if (hdrIdx < 0) continue
    const head = sh.rows[hdrIdx].map(c => String(c ?? ''))
    const hs = head.map(low)
    const iQ = hs.findIndex(h => Q.test(h)), iP = hs.findIndex(h => PG.test(h))
    const iPer = hs.findIndex(h => /^(periode|period|date range|datointerval|dato|date)$/.test(h))
    // periodebetegnelser over overskriftsrækken (fx sammenflettede celler) – udfyldes fremad
    const above: string[] = head.map(() => '')
    if (hdrIdx > 0) {
      let last = ''
      const prow = sh.rows[hdrIdx - 1] || []
      head.forEach((_, i) => { const v = String(prow[i] ?? '').trim(); if (v) last = v; above[i] = last })
    }
    const groups = new Map<string, Partial<Record<'clicks' | 'impressions' | 'ctr' | 'position', number>>>()
    let deltaCols = 0
    const deltaIdx: Partial<Record<'clicks' | 'impressions', number>> = {}
    hs.forEach((h, idx) => {
      if (idx === iQ || idx === iP || idx === iPer) return
      const k = METRIC(h); if (!k) return
      if (isDeltaHeader(h) || isDeltaHeader(low(above[idx]))) { deltaCols++; if ((k === 'clicks' || k === 'impressions') && deltaIdx[k] == null && !/%|procent|percent/.test(h)) deltaIdx[k] = idx; return }
      const label = periodLabelOf(head[idx]) || periodLabelOf(above[idx])
      const g = groups.get(label) ?? {}
      if (g[k] != null) { warnings.push(`Kolonnen «${head[idx]}» findes flere gange for samme periode – den første bruges.`); return }
      g[k] = idx; groups.set(label, g)
    })
    if (groups.size === 0) continue
    const labelsHere = Array.from(groups.keys())
    if (labelsHere.length > 1 || labelsHere[0]) labelsHere.forEach(l => { if (l) addDef(l) })
    for (let i = hdrIdx + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i]; if (!r) continue
      const q = String(r[iQ] ?? '').trim(), pg = String(r[iP] ?? '').trim()
      if (!q || !pg) { if (r.some(c => c != null && String(c).trim() !== '')) skipped++; continue }
      dataRows++; pairSet[q.toLowerCase() + '\u0001' + normUrl(pg)] = true
      const sample: Record<'clicks' | 'impressions', Record<string, number>> = { clicks: {}, impressions: {} }
      for (const [lab, g] of Array.from(groups.entries())) {
        const imp = g.impressions != null ? num(r[g.impressions]) : null
        const clk = g.clicks != null ? num(r[g.clicks]) : null
        if (imp == null && clk == null) continue
        let period = '', src: GscPageParse['periodSource'] = 'ukendt'
        if (lab) { period = lab; src = 'kolonneoverskrift' }
        else if (iPer >= 0 && r[iPer] != null && String(r[iPer]).trim()) { period = String(r[iPer]).trim(); src = 'kolonne' }
        else if (multiSheet) { period = sh.name; src = 'fane' }
        else if (filterPeriod) { period = filterPeriod; src = 'filtre' }
        else if (namePeriod) { period = namePeriod; src = 'filnavn' }
        if (period) addDef(period)
        if (src !== 'ukendt' && (source === 'ukendt' || source === 'filnavn')) source = src
        // CTR beregnes af klik/eksponeringer (entydigt); filens CTR-kolonne bruges kun som kontrol eller reserve
        let fileCtr = g.ctr != null ? num(r[g.ctr]) : null
        if (g.ctr != null && typeof r[g.ctr] === 'string' && /%/.test(String(r[g.ctr])) && fileCtr != null) fileCtr = fileCtr / 100
        let ctr: number | null = imp != null && imp > 0 && clk != null ? clk / imp : fileCtr
        if (imp != null && imp > 0 && clk != null && fileCtr != null) {
          const c0 = clk / imp
          if (Math.min(Math.abs(fileCtr - c0), Math.abs(fileCtr / 100 - c0)) > 0.003) ctrMismatch++
        } else if (fileCtr != null && ctr === fileCtr && ctr > 1) ctr = ctr / 100
        if (imp != null) sample.impressions[period || 'ukendt'] = imp
        if (clk != null) sample.clicks[period || 'ukendt'] = clk
        rows.push({ query: q, page: pg, period: period || 'ukendt', clicks: clk ?? 0, impressions: imp ?? 0, ctr, position: g.position != null ? num(r[g.position]) : null })
      }
      for (const m of ['clicks', 'impressions'] as const) {
        const di = deltaIdx[m]
        const dv = di != null ? num(r[di]) : null
        if (dv != null && Object.keys(sample[m]).length >= 2) deltaSamples.push({ metric: m, delta: dv, vals: sample[m] })
      }
    }
    // (ændringskolonner kontrolleres efter periodeafgørelsen)
    if (deltaCols > 0) warnings.push(`${deltaCols} ændringskolonner (forskel mellem perioder) er genkendt og ikke brugt som måledata.`)
  }
  if (rows.length === 0) return null
  const used = Array.from(new Set(rows.map(r => r.period)))
  const periodInfo = resolvePeriods(used.filter(p => p !== 'ukendt').length === used.length ? defs.filter(d => used.indexOf(d.label) >= 0) : [])
  if (periodInfo.status === 'uklar' && !periodInfo.error) periodInfo.error = 'Periode kunne ikke aflæses.'
  // Kontrol af kolonnetilknytning: ændringskolonnerne skal passe til (ny − tidligere). Omvendt fortegn = perioderne er byttet om.
  if (periodInfo.status === 'ok' && deltaSamples.length > 0 && periodInfo.current && periodInfo.previous) {
    let fwd = 0, rev = 0, bad = 0, n = 0
    for (const d of deltaSamples) {
      const c = d.vals[periodInfo.current], p = d.vals[periodInfo.previous]
      if (c == null || p == null || c === p) continue
      n++
      if (Math.abs(d.delta - (c - p)) <= 0.5) fwd++
      else if (Math.abs(d.delta - (p - c)) <= 0.5) rev++
      else bad++
    }
    if (n >= 3 && rev > fwd && rev / n > 0.5) { periodInfo.status = 'uklar'; periodInfo.error = 'Ændringskolonnerne i filen passer til den modsatte periodeorden end den, datoerne i overskrifterne angiver – kolonnetilknytningen er inkonsistent og kan ikke bruges.' }
    else if (n >= 3 && bad / n > 0.1) warnings.push(`${bad} af ${n} rækker har ændringsværdier, der ikke svarer til forskellen mellem perioderne – kontrollér eksporten.`)
    else if (n >= 3) warnings.push(`Kontrol: ændringskolonnerne svarer til (ny − tidligere) i ${fwd} af ${n} rækker.`)
  }
  if (ctrMismatch > 0) warnings.push(`${ctrMismatch} målinger har en CTR-kolonne, der afviger fra klik/eksponeringer – CTR beregnes af klik og eksponeringer.`)
  if (skipped > 0) warnings.push(`${skipped} rækker uden forespørgsel eller side er sprunget over.`)
  return { rows, periods: used, periodSource: source, warnings, periodInfo, dataRows, skippedRows: skipped, pairs: Object.keys(pairSet).length }
}

// Rækker for den analyserede URL i den aktuelle og den tidligere periode – ét centralt sted
export interface PerfRow { keyword: string; cur: { clicks: number; impressions: number; ctr: number | null; position: number | null } | null; prev: { clicks: number; impressions: number; ctr: number | null; position: number | null } | null }
export interface Performance {
  status: 'ok' | 'enkelt' | 'valideringsfejl' | 'ingen'
  error?: string
  urlFound: boolean
  currentLabel: string | null
  previousLabel: string | null
  rows: PerfRow[]
  totals: { cur: { clicks: number; impressions: number } | null; prev: { clicks: number; impressions: number } | null }
  notes: string[]
}
export function buildPerformance(gscPages: GscPageRow[] | undefined, info: PeriodInfo | undefined, pageUrl: string, validationError?: string): Performance {
  const base: Performance = { status: 'ingen', urlFound: false, currentLabel: null, previousLabel: null, rows: [], totals: { cur: null, prev: null }, notes: [] }
  if (validationError) return { ...base, status: 'valideringsfejl', error: validationError }
  if (!gscPages || gscPages.length === 0) return base
  if (!info || info.status === 'uklar') return { ...base, status: 'valideringsfejl', error: info?.error || 'Perioderne kan ikke identificeres entydigt.' }
  const me = normUrl(pageUrl)
  const mine = gscPages.filter(r => normUrl(r.page) === me)
  const out: Performance = { ...base, status: info.status === 'ok' ? 'ok' : 'enkelt', currentLabel: info.current, previousLabel: info.previous, urlFound: mine.length > 0 }
  if (!me) { out.status = 'valideringsfejl'; out.error = 'Den analyserede URL er ikke angivet – GSC-rækker kan ikke filtreres på siden.'; return out }
  if (mine.length === 0) { out.notes.push('Den analyserede URL findes ikke i GSC-filen – ingen tal tilskrives denne side.'); return out }
  const map = new Map<string, PerfRow>()
  for (const r of mine) {
    const k = r.query.toLowerCase().trim()
    const e = map.get(k) ?? { keyword: r.query, cur: null, prev: null }
    // Flere rækker for samme forespørgsel, URL og periode (fx URL med sporingsparametre) lægges sammen – aldrig overskrives
    const merge = (x: PerfRow['cur']) => {
      if (!x) return { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }
      const ti = x.impressions + r.impressions, tc = x.clicks + r.clicks
      const pos = x.position != null && r.position != null && ti > 0 ? (x.position * x.impressions + r.position * r.impressions) / ti : x.position ?? r.position
      return { clicks: tc, impressions: ti, ctr: ti > 0 ? tc / ti : null, position: pos }
    }
    if (r.period === info.current) e.cur = merge(e.cur)
    else if (r.period === info.previous) e.prev = merge(e.prev)
    map.set(k, e)
  }
  out.rows = Array.from(map.values()).filter(r => r.cur || r.prev).sort((a, b) => (b.cur?.impressions ?? 0) - (a.cur?.impressions ?? 0))
  const sum = (sel: (r: PerfRow) => PerfRow['cur']) => { const x = out.rows.map(sel).filter((v): v is NonNullable<PerfRow['cur']> => !!v); return x.length ? { clicks: x.reduce((a, v) => a + v.clicks, 0), impressions: x.reduce((a, v) => a + v.impressions, 0) } : null }
  out.totals = { cur: sum(r => r.cur), prev: sum(r => r.prev) }
  out.notes.push('Summerne er summer af rækkerne i GSC-filen for denne URL og er ikke validerede totaler: eksporten kan være afkortet og udelader anonymiserede søgninger.')
  return out
}

// ── Ahrefs: Previous URL / Current URL (header-baseret) ─────────────────────
export function parseAhrefsUrls(raw: Cell[][]): AhrefsUrlRow[] {
  const hdrIdx = raw.slice(0, 4).findIndex(r => (r || []).some(c => low(c) === 'keyword'))
  if (hdrIdx < 0) return []
  const hs = raw[hdrIdx].map(low)
  const idx = (...names: string[]) => hs.findIndex(h => names.includes(h))
  const iKw = idx('keyword'), iPrevU = idx('previous url', 'prev url', 'previous ranking url'), iCurU = idx('current url', 'current ranking url')
  const iLast = idx('last ranking url'), iOth = idx('other ranking urls')
  if (iPrevU < 0 && iCurU < 0 && iLast < 0 && iOth < 0) return []
  const iVol = idx('volume'), iPP = idx('previous position'), iCP = idx('current position')
  const split = (c: Cell) => String(c ?? '').split(/[\n\s,;]+/).map(s => s.trim()).filter(isUrl)
  const out: AhrefsUrlRow[] = []
  for (let i = hdrIdx + 1; i < raw.length; i++) {
    const r = raw[i]; if (!r || !r[iKw]) continue
    const first = (j: number) => (j >= 0 ? split(r[j])[0] ?? '' : '')
    out.push({
      keyword: String(r[iKw]).trim(), volume: iVol >= 0 ? num(r[iVol]) : null,
      prevPos: iPP >= 0 ? num(r[iPP]) : null, currPos: iCP >= 0 ? num(r[iCP]) : null,
      prevUrl: first(iPrevU), currUrl: first(iCurU), lastUrl: first(iLast), otherUrls: iOth >= 0 ? split(r[iOth]) : [],
    })
  }
  return out.filter(x => x.prevUrl || x.currUrl || x.lastUrl || x.otherUrls.length)
}

// ── URL-heuristik (kun URL – sidernes indhold er ikke læst) ─────────────────
export type UrlKind = 'produkt' | 'kategori' | 'artikel' | 'ukendt'
const UNIT = /^(\d+([.,]\d+)?|pct|procent|ml|cl|dl|l|ltr|liter|kg|g|mg|mm|cm|stk|pk|pakke|x|xl|xs|s|m)$/
const ID_SEG = /^(p|id|sku)?[-_]?\d{3,}$/
function segs(u: string): string[] { return normUrl(u).split('/').slice(1).filter(Boolean) }
export function lastMeaningful(u: string): string { const s = segs(u).filter(x => !ID_SEG.test(x)); return s[s.length - 1] ?? '' }
function baseTokens(seg: string): string[] { return seg.split(/[-_+\s]+/).filter(t => t && !UNIT.test(t) && !/^\d+%$/.test(t)) }
function variantTokens(seg: string): string[] { return seg.split(/[-_+\s]+/).filter(t => UNIT.test(t) || /^\d+%$/.test(t)) }

export function urlKind(u: string): UrlKind {
  const n = normUrl(u), ss = segs(u)
  if (/\/(blog|viden|guide|guides|artikel|artikler|nyheder|knowledge|lexicon|leksikon)(\/|$)/.test(n)) return 'artikel'
  if (ss.some(x => /^p[-_]?\d+$/.test(x)) || /\/(produkt|product|p)\//.test(n)) return 'produkt'
  const last = lastMeaningful(u)
  if (variantTokens(last).length > 0 && baseTokens(last).length > 0) return 'produkt'
  return 'ukendt'
}
export function sameFamily(a: string, b: string): boolean {
  const la = lastMeaningful(a), lb = lastMeaningful(b)
  if (!la || !lb) return false
  const pa = segs(a).filter(x => !ID_SEG.test(x)).slice(0, -1).join('/'), pb = segs(b).filter(x => !ID_SEG.test(x)).slice(0, -1).join('/')
  const ta = baseTokens(la), tb = baseTokens(lb)
  if (ta.length === 0 || tb.length === 0) return false
  const A = new Set(ta), B = new Set(tb)
  const inter = ta.filter(t => B.has(t)).length, uni = new Set([...ta, ...tb]).size
  const jac = inter / uni
  const differsByVariant = variantTokens(la).join() !== variantTokens(lb).join() || la !== lb
  return jac >= 0.75 && pa === pb && differsByVariant && variantTokens(la).length > 0 && variantTokens(lb).length > 0 && A.size > 0
}

// ── Analyse ─────────────────────────────────────────────────────────────────
export type OverlapClass = 'ingen' | 'historisk' | 'legitimt' | 'uhensigtsmaessigt' | 'mulig-kannibalisering' | 'begraenset' | 'utilstraekkeligt'
export const OVERLAP_LABEL: Record<OverlapClass, string> = {
  ingen: 'Ingen overlap', historisk: 'Historisk overlap (kun tidligere periode)', legitimt: 'Legitimt overlap (produktvarianter)', uhensigtsmaessigt: 'Muligt uhensigtsmæssigt overlap',
  'mulig-kannibalisering': 'Mulig kannibalisering – kræver manuel vurdering', begraenset: 'Begrænset overlap', utilstraekkeligt: 'For få data til en vurdering',
}
export interface OverlapUrl {
  url: string; isCurrent: boolean; kind: UrlKind
  periods: { period: string; clicks: number; impressions: number; ctr: number | null; position: number | null; share: number | null }[]
  sources: ('GSC' | 'Ahrefs')[]
  status: 'aktuel' | 'kun-tidligere' | 'kun-ahrefs'
  currentImpressions: number
  previousImpressions: number
  ahrefsRole: string[]
}
export interface OverlapKeyword {
  keyword: string
  classification: OverlapClass
  urls: OverlapUrl[]
  primaryPeriod: string
  totalImpressions: number
  switchEvidence: string
  ahrefsChange: { prevUrl: string; currUrl: string } | null
  reasons: string[]
  checks: string[]
  uncertainty: string[]
}
export interface OverlapResult {
  available: boolean
  keywords: OverlapKeyword[]
  otherOverlapCount: number
  sources: { gsc: { rows: number; periods: string[]; periodSource: string; urls: number; queries: number } | null; ahrefs: { rows: number; withPrevCurr: number } | null }
  notes: string[]
  summary: string
  period: { current: string | null; previous: string | null; status: string }
  validationError?: string
}

const MIN_TOTAL_IMP = 100, MIN_URL_IMP = 20, MIN_SHARE = 0.1, MIN_PERIOD_IMP = 30

export function analyzeOverlap(args: {
  pageUrl: string; gscPages?: GscPageRow[]; gscPeriod?: GscPageParse & { periodInfo?: PeriodInfo }; ahrefsUrls?: AhrefsUrlRow[]; keywords?: string[]; serpKinds?: Record<string, string>
}): OverlapResult {
  const gsc = args.gscPages ?? [], ah = args.ahrefsUrls ?? []
  const me = normUrl(args.pageUrl)
  const empty: OverlapResult = { available: false, keywords: [], otherOverlapCount: 0, sources: { gsc: null, ahrefs: null }, notes: [], summary: '', period: { current: null, previous: null, status: 'ingen' } }
  if (gsc.length === 0 && ah.length === 0) return empty
  const info = args.gscPeriod?.periodInfo
  if (gsc.length > 0 && (!info || info.status === 'uklar')) {
    return { ...empty, available: true, validationError: info?.error || 'Perioderne i GSC-filen kan ikke identificeres entydigt – overlapanalysen er stoppet.', summary: 'Datavalideringsfejl: overlap kan ikke vurderes, før GSC-perioderne er entydige.', period: { current: null, previous: null, status: 'uklar' }, sources: { gsc: { rows: gsc.length, periods: args.gscPeriod?.periods ?? [], periodSource: args.gscPeriod?.periodSource ?? 'ukendt', urls: 0, queries: 0 }, ahrefs: null } }
  }
  const curLabel = info?.current ?? null, prevLabel = info?.previous ?? null
  const normKeyword = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')
  const byKw = new Map<string, { kw: string; gsc: GscPageRow[]; ah?: AhrefsUrlRow }>()
  for (const r of gsc) { const k = normKeyword(r.query); const e = byKw.get(k) ?? { kw: r.query, gsc: [] }; e.gsc.push(r); byKw.set(k, e) }
  for (const r of ah) { const k = normKeyword(r.keyword); const e = byKw.get(k) ?? { kw: r.keyword, gsc: [] }; e.ah = r; byKw.set(k, e) }
  const analysisKeys = new Set((args.keywords ?? []).map(normKeyword))

  const out: OverlapKeyword[] = []
  let otherOverlap = 0
  for (const [k, e] of Array.from(byKw.entries())) {
    const urlMap = new Map<string, OverlapUrl>()
    const touch = (u: string, src: 'GSC' | 'Ahrefs', role?: string) => {
      const n = normUrl(u); if (!n) return null
      const x = urlMap.get(n) ?? { url: u, isCurrent: n === me, kind: urlKind(u), periods: [], sources: [], ahrefsRole: [], status: 'kun-ahrefs' as const, currentImpressions: 0, previousImpressions: 0 }
      if (!x.sources.includes(src)) x.sources.push(src)
      if (role && !x.ahrefsRole.includes(role)) x.ahrefsRole.push(role)
      urlMap.set(n, x); return x
    }
    for (const r of e.gsc) {
      const x = touch(r.page, 'GSC')!
      const p = x.periods.find(q => q.period === r.period)
      if (p) { // flere rækker for samme URL+periode: læg sammen, vægtet position
        const ti = p.impressions + r.impressions
        p.position = ti > 0 && p.position != null && r.position != null ? (p.position * p.impressions + r.position * r.impressions) / ti : p.position ?? r.position
        p.clicks += r.clicks; p.impressions = ti; p.ctr = ti > 0 ? p.clicks / ti : null
      } else x.periods.push({ period: r.period, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, share: null })
    }
    let ahrefsChange: OverlapKeyword['ahrefsChange'] = null
    if (e.ah) {
      if (e.ah.prevUrl) touch(e.ah.prevUrl, 'Ahrefs', 'Previous URL')
      if (e.ah.currUrl) touch(e.ah.currUrl, 'Ahrefs', 'Current URL')
      if (e.ah.lastUrl) touch(e.ah.lastUrl, 'Ahrefs', 'Seneste rangerende URL')
      for (const o of e.ah.otherUrls) touch(o, 'Ahrefs', 'Anden rangerende URL')
      if (e.ah.prevUrl && e.ah.currUrl && normUrl(e.ah.prevUrl) !== normUrl(e.ah.currUrl)) ahrefsChange = { prevUrl: e.ah.prevUrl, currUrl: e.ah.currUrl }
    }
    const urls = Array.from(urlMap.values())
    if (urls.length < 2) continue
    const involvesMe = urls.some(u => u.isCurrent)
    if (!involvesMe && !analysisKeys.has(k)) { otherOverlap++; continue }
    if (!involvesMe) { otherOverlap++; continue }

    // perioder og andele
    const allPeriods = Array.from(new Set(urls.flatMap(u => u.periods.map(p => p.period))))
    const totalsBy = (per: string) => urls.reduce((s, u) => s + (u.periods.find(p => p.period === per)?.impressions ?? 0), 0)
    for (const per of allPeriods) { const t = totalsBy(per); for (const u of urls) { const p = u.periods.find(q => q.period === per); if (p) p.share = t > 0 ? p.impressions / t : null } }
    const primary = curLabel ?? ''
    for (const u of urls) { u.currentImpressions = u.periods.find(p => p.period === curLabel)?.impressions ?? 0; u.previousImpressions = prevLabel ? (u.periods.find(p => p.period === prevLabel)?.impressions ?? 0) : 0; u.status = u.currentImpressions > 0 ? 'aktuel' : u.previousImpressions > 0 ? 'kun-tidligere' : 'kun-ahrefs' }
    const curUrls = urls.filter(u => u.currentImpressions > 0), prevUrls = urls.filter(u => u.previousImpressions > 0)
    const total = primary ? totalsBy(primary) : 0
    const share = (u: OverlapUrl) => u.periods.find(p => p.period === primary)?.share ?? 0
    const imps = (u: OverlapUrl) => u.periods.find(p => p.period === primary)?.impressions ?? 0
    urls.sort((a, b) => imps(b) - imps(a) || Number(b.isCurrent) - Number(a.isCurrent))

    // skift af dominerende URL mellem perioder
    let switchEvidence = ''
    const dom: { per: string; url: string }[] = []
    for (const per of [prevLabel, curLabel].filter((x): x is string => !!x)) {
      if (totalsBy(per) < MIN_PERIOD_IMP) continue
      const best = urls.slice().sort((a, b) => (b.periods.find(p => p.period === per)?.impressions ?? 0) - (a.periods.find(p => p.period === per)?.impressions ?? 0))[0]
      dom.push({ per, url: best.url })
    }
    if (new Set(dom.map(d => normUrl(d.url))).size > 1) switchEvidence = `Historisk skift: den URL med flest eksponeringer er ændret mellem perioderne (${dom.map(d => `${d.per}: ${d.url}`).join(' → ')}).`
    if (ahrefsChange) switchEvidence += (switchEvidence ? ' ' : '') + `Ahrefs: rangerende URL er skiftet fra ${ahrefsChange.prevUrl} til ${ahrefsChange.currUrl}.`

    const material = urls.filter(u => imps(u) >= MIN_URL_IMP && share(u) >= MIN_SHARE)
    const family = material.length >= 2 && material.every((u, i) => i === 0 || material.slice(0, i).some(v => sameFamily(u.url, v.url)))
    const hasGsc = e.gsc.length > 0
    const reasons: string[] = [], uncertainty: string[] = [], checks: string[] = []
    uncertainty.push('Vurderingen bygger kun på URL-mønstre og tal – sidernes indhold, titler og produktmatch er ikke læst.')
    if (!hasGsc) uncertainty.push('Ingen GSC-tal for dette søgeord – kun Ahrefs-observation af rangerende URL.')
    if (!prevLabel) uncertainty.push('Kun én periode – udvikling og historisk overlap kan ikke vurderes.')
    if (urls.some(u => u.periods.some(p => p.position != null && p.position > 30))) uncertainty.push('Mindst én URL har gennemsnitsposition over 30 – tallene er svage.')

    let cls: OverlapClass
    if (hasGsc && curUrls.length < 2 && prevUrls.length >= 2) { cls = 'historisk'; reasons.push(`Flere URL'er havde eksponeringer i den tidligere periode (${prevLabel}), men i den aktuelle periode (${curLabel}) har ${curUrls.length === 1 ? 'kun én URL' : 'ingen URL'} eksponeringer. Det er ikke aktuelt overlap.`) }
    else if (hasGsc && curUrls.length < 2 && !e.ah) { cls = 'begraenset'; reasons.push('Kun én URL har aktuelle eksponeringer for søgeordet.') }
    else if (hasGsc && total < MIN_TOTAL_IMP) { cls = 'utilstraekkeligt'; reasons.push(`Kun ${total} eksponeringer i perioden «${primary}» på tværs af URL'erne (under ${MIN_TOTAL_IMP}) – for få til at kalde overlappet et problem.`) }
    else if (!hasGsc) {
      cls = ahrefsChange ? 'utilstraekkeligt' : 'utilstraekkeligt'
      reasons.push('Flere URL\'er er observeret i Ahrefs, men uden GSC-tal kan betydningen ikke vurderes.')
    } else if (material.length < 2) { cls = 'begraenset'; reasons.push(`Kun én URL har væsentlig andel af eksponeringerne (andre under ${Math.round(MIN_SHARE * 100)} % eller ${MIN_URL_IMP} eksponeringer).`) }
    else if (family) { cls = 'legitimt'; reasons.push('URL\'erne ligner varianter af samme produkt (fx størrelse eller koncentration). Overlap mellem varianter er normalt.') }
    else {
      const kinds = new Set(material.map(u => u.kind))
      const pos = material.map(u => u.periods.find(p => p.period === primary)?.position).filter((x): x is number => x != null)
      const close = pos.length >= 2 ? Math.max(...pos) - Math.min(...pos) <= 8 : false
      const sameKind = kinds.size === 1 && !kinds.has('ukendt')
      if (switchEvidence && close && sameKind) { cls = 'mulig-kannibalisering'; reasons.push('URL\'er af samme type deler eksponeringerne, ligger tæt på hinanden i placering, og den rangerende URL skifter. Det er et mønster, der kan tyde på kannibalisering – men er ikke dokumenteret.') }
      else { cls = 'uhensigtsmaessigt'; reasons.push(kinds.size > 1 || kinds.has('ukendt') ? 'URL\'erne ser ud til at have forskellig funktion (eller typen kan ikke aflæses), men deler eksponeringer.' : 'Flere URL\'er deler eksponeringer uden tydeligt skift eller tæt placering.') }
    }
    checks.push('Sammenlign søgeintentionen i SERP med hver URL (produkt, kategori eller guide).', 'Kontrollér produktmatch: svarer hver URL på præcis det produkt/den variant, søgeordet beskriver?', 'Afgør, om URL\'erne tjener forskellige trin i kunderejsen, før noget ændres.')
    const sk = args.serpKinds?.[k]
    if (sk) reasons.push(`SERP-analysen for søgeordet viser overvejende ${sk}.`)
    out.push({ keyword: e.kw, classification: cls, urls, primaryPeriod: primary, totalImpressions: total, switchEvidence, ahrefsChange, reasons, checks, uncertainty })
  }
  const rank: Record<OverlapClass, number> = { 'mulig-kannibalisering': 0, uhensigtsmaessigt: 1, legitimt: 2, historisk: 3, begraenset: 4, utilstraekkeligt: 5, ingen: 6 }
  out.sort((a, b) => rank[a.classification] - rank[b.classification] || b.totalImpressions - a.totalImpressions)

  const gscSrc = gsc.length ? { rows: args.gscPeriod?.pairs ?? gsc.length, periods: args.gscPeriod?.periods ?? Array.from(new Set(gsc.map(r => r.period))), periodSource: args.gscPeriod?.periodSource ?? 'ukendt', urls: new Set(gsc.map(r => normUrl(r.page))).size, queries: new Set(gsc.map(r => normKeyword(r.query))).size } : null
  const notes = [
    'Tallene er summer af rækkerne i den indlæste fil. GSC-eksporter har rækkegrænser og udelader anonymiserede søgninger, så de kan ikke bruges som komplette totaler for domænet eller en URL uden validering.',
    'Intet her er en anbefaling om sammenlægning, canonical eller redirect. Fælles søgeord alene er ikke grundlag for sådanne ændringer.',
  ]
  const n = (c: OverlapClass) => out.filter(x => x.classification === c).length
  const activeCount = out.filter(x => x.urls.filter(u => u.currentImpressions > 0).length >= 2).length
  const summary = out.length === 0 ? 'Ingen søgeord med overlap mellem denne side og andre URL\'er i de indlæste data.'
    : `${out.length} søgeord med flere URL'er inkl. denne side – heraf ${activeCount} med aktuelle eksponeringer på mindst to URL'er og ${n('historisk')} kun historisk: ${n('legitimt')} legitimt (varianter), ${n('uhensigtsmaessigt')} muligt uhensigtsmæssigt, ${n('mulig-kannibalisering')} mulig kannibalisering, ${n('begraenset') + n('utilstraekkeligt')} med for få data eller begrænset betydning.`
  return { available: true, period: { current: curLabel, previous: prevLabel, status: info?.status ?? 'ingen' }, keywords: out, otherOverlapCount: otherOverlap, sources: { gsc: gscSrc, ahrefs: ah.length ? { rows: ah.length, withPrevCurr: ah.filter(x => x.prevUrl || x.currUrl).length } : null }, notes, summary }
}
