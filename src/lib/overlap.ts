// lib/overlap.ts
// URL-overlap og mulig kannibalisering ud fra GSC (forespørgsel × landingsside × periode) og Ahrefs (Previous/Current URL).
// Ren logik uden netværk. Konklusioner er altid foreløbige: sidernes indhold læses ikke her.

export interface GscPageRow { query: string; page: string; period: string; clicks: number; impressions: number; ctr: number | null; position: number | null }
export interface GscPageParse {
  rows: GscPageRow[]
  periods: string[]
  periodSource: 'kolonne' | 'kolonneoverskrift' | 'fane' | 'filtre' | 'filnavn' | 'ukendt'
  warnings: string[]
}
export interface AhrefsUrlRow { keyword: string; volume: number | null; prevPos: number | null; currPos: number | null; prevUrl: string; currUrl: string; lastUrl: string; otherUrls: string[] }

type Cell = string | number | null | undefined
export interface SheetRaw { name: string; rows: Cell[][] }

const low = (c: Cell) => String(c ?? '').toLowerCase().trim()
const num = (v: Cell): number | null => {
  if (v == null || v === '') return null
  const s = String(v).replace('%', '').replace(/\s/g, '').replace(',', '.')
  const n = Number(s)
  return isNaN(n) ? null : n
}
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim())

export function normUrl(u: string): string {
  let s = (u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
  try { s = decodeURIComponent(s) } catch { /* behold */ }
  return s
}

// ── GSC: forespørgsel × side ─────────────────────────────────────────────────
const METRIC = (h: string): 'clicks' | 'impressions' | 'ctr' | 'position' | null =>
  /^(klik|clicks?)\b/.test(h) ? 'clicks' : /^(eksponeringer|visninger|impressions?)\b/.test(h) ? 'impressions' : /^ctr\b/.test(h) ? 'ctr' : /^(placering|position|gns\.? placering|average position)\b/.test(h) ? 'position' : null

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

export function parseGscQueryPage(sheets: SheetRaw[], fileName = ''): GscPageParse | null {
  const warnings: string[] = []
  const rows: GscPageRow[] = []
  const periodsSeen: string[] = []
  let source: GscPageParse['periodSource'] = 'ukendt'
  const filterPeriod = periodFromFilters(sheets)
  const namePeriod = periodFromFileName(fileName)
  const multiSheet = sheets.filter(s => !/^(filtre|filters?)$/i.test(s.name.trim())).length > 1

  for (const sh of sheets) {
    if (/^(filtre|filters?)$/i.test(sh.name.trim())) continue
    const hdrIdx = sh.rows.slice(0, 5).findIndex(r => {
      const hs = (r || []).map(low)
      return hs.some(h => /forespørg|quer|søgeord|keyword/.test(h)) && hs.some(h => /landingsside|landing page|^side$|^page$|^sider$|top pages|^url$|mest anvendte sider/.test(h))
    })
    if (hdrIdx < 0) continue
    const hs = sh.rows[hdrIdx].map(low)
    const iQ = hs.findIndex(h => /forespørg|quer|søgeord|keyword/.test(h))
    const iP = hs.findIndex(h => /landingsside|landing page|^side$|^page$|^sider$|top pages|^url$|mest anvendte sider/.test(h))
    const iPer = hs.findIndex(h => /^(periode|period|date range|datointerval|dato|date)$/.test(h))
    // metrics, evt. med periode i overskriften: «Klik – Seneste 3 måneder»
    const groups = new Map<string, Partial<Record<'clicks' | 'impressions' | 'ctr' | 'position', number>>>()
    hs.forEach((h, idx) => {
      if (idx === iQ || idx === iP || idx === iPer) return
      const m = h.match(/^(.+?)\s*[-–—:(]\s*(.+?)\)?$/)
      const base = m ? m[1].trim() : h
      const k = METRIC(base)
      if (!k) return
      const label = m ? String(sh.rows[hdrIdx][idx]).replace(/^.+?\s*[-–—:(]\s*/, '').replace(/\)$/, '').trim() : ''
      const g = groups.get(label) ?? {}
      g[k] = idx
      groups.set(label, g)
    })
    if (groups.size === 0) continue
    for (let i = hdrIdx + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i]
      if (!r) continue
      const q = String(r[iQ] ?? '').trim(), pg = String(r[iP] ?? '').trim()
      if (!q || !pg) continue
      for (const [lab, g] of groups) {
        const imp = g.impressions != null ? num(r[g.impressions]) : null
        const clk = g.clicks != null ? num(r[g.clicks]) : null
        if (imp == null && clk == null) continue
        let period = '', src: GscPageParse['periodSource'] = 'ukendt'
        if (lab) { period = lab; src = 'kolonneoverskrift' }
        else if (iPer >= 0 && r[iPer] != null && String(r[iPer]).trim()) { period = String(r[iPer]).trim(); src = 'kolonne' }
        else if (multiSheet) { period = sh.name; src = 'fane' }
        else if (filterPeriod) { period = filterPeriod; src = 'filtre' }
        else if (namePeriod) { period = namePeriod; src = 'filnavn' }
        if (src !== 'ukendt' && (source === 'ukendt' || source === 'filnavn')) source = src
        if (!periodsSeen.includes(period)) periodsSeen.push(period)
        let ctr = g.ctr != null ? num(r[g.ctr]) : null
        if (ctr != null && ctr > 1) ctr = ctr / 100
        rows.push({ query: q, page: pg, period: period || 'ukendt', clicks: clk ?? 0, impressions: imp ?? 0, ctr, position: g.position != null ? num(r[g.position]) : null })
      }
    }
  }
  if (rows.length === 0) return null
  if (periodsSeen.every(p => !p)) warnings.push('Periode kunne ikke aflæses i filen – angiv den manuelt. Sammenligning på tværs af perioder er ikke mulig.')
  return { rows, periods: periodsSeen.map(p => p || 'ukendt'), periodSource: source, warnings }
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
function lastMeaningful(u: string): string { const s = segs(u).filter(x => !ID_SEG.test(x)); return s[s.length - 1] ?? '' }
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
export type OverlapClass = 'ingen' | 'legitimt' | 'uhensigtsmaessigt' | 'mulig-kannibalisering' | 'begraenset' | 'utilstraekkeligt'
export const OVERLAP_LABEL: Record<OverlapClass, string> = {
  ingen: 'Ingen overlap', legitimt: 'Legitimt overlap (produktvarianter)', uhensigtsmaessigt: 'Muligt uhensigtsmæssigt overlap',
  'mulig-kannibalisering': 'Mulig kannibalisering – kræver manuel vurdering', begraenset: 'Begrænset overlap', utilstraekkeligt: 'For få data til en vurdering',
}
export interface OverlapUrl {
  url: string; isCurrent: boolean; kind: UrlKind
  periods: { period: string; clicks: number; impressions: number; ctr: number | null; position: number | null; share: number | null }[]
  sources: ('GSC' | 'Ahrefs')[]
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
}

const MIN_TOTAL_IMP = 100, MIN_URL_IMP = 20, MIN_SHARE = 0.1, MIN_PERIOD_IMP = 30

export function analyzeOverlap(args: {
  pageUrl: string; gscPages?: GscPageRow[]; gscPeriod?: GscPageParse; ahrefsUrls?: AhrefsUrlRow[]; keywords?: string[]; serpKinds?: Record<string, string>
}): OverlapResult {
  const gsc = args.gscPages ?? [], ah = args.ahrefsUrls ?? []
  const me = normUrl(args.pageUrl)
  const empty: OverlapResult = { available: false, keywords: [], otherOverlapCount: 0, sources: { gsc: null, ahrefs: null }, notes: [], summary: '' }
  if (gsc.length === 0 && ah.length === 0) return empty
  const normKeyword = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ')
  const byKw = new Map<string, { kw: string; gsc: GscPageRow[]; ah?: AhrefsUrlRow }>()
  for (const r of gsc) { const k = normKeyword(r.query); const e = byKw.get(k) ?? { kw: r.query, gsc: [] }; e.gsc.push(r); byKw.set(k, e) }
  for (const r of ah) { const k = normKeyword(r.keyword); const e = byKw.get(k) ?? { kw: r.keyword, gsc: [] }; e.ah = r; byKw.set(k, e) }
  const analysisKeys = new Set((args.keywords ?? []).map(normKeyword))

  const out: OverlapKeyword[] = []
  let otherOverlap = 0
  for (const [k, e] of byKw) {
    const urlMap = new Map<string, OverlapUrl>()
    const touch = (u: string, src: 'GSC' | 'Ahrefs', role?: string) => {
      const n = normUrl(u); if (!n) return null
      const x = urlMap.get(n) ?? { url: u, isCurrent: n === me, kind: urlKind(u), periods: [], sources: [], ahrefsRole: [] }
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
    const urls = [...urlMap.values()]
    if (urls.length < 2) continue
    const involvesMe = urls.some(u => u.isCurrent)
    if (!involvesMe && !analysisKeys.has(k)) { otherOverlap++; continue }
    if (!involvesMe) { otherOverlap++; continue }

    // perioder og andele
    const allPeriods = [...new Set(urls.flatMap(u => u.periods.map(p => p.period)))]
    const totalsBy = (per: string) => urls.reduce((s, u) => s + (u.periods.find(p => p.period === per)?.impressions ?? 0), 0)
    for (const per of allPeriods) { const t = totalsBy(per); for (const u of urls) { const p = u.periods.find(q => q.period === per); if (p) p.share = t > 0 ? p.impressions / t : null } }
    const primary = allPeriods.slice().sort((a, b) => totalsBy(b) - totalsBy(a))[0] ?? ''
    const total = primary ? totalsBy(primary) : 0
    const share = (u: OverlapUrl) => u.periods.find(p => p.period === primary)?.share ?? 0
    const imps = (u: OverlapUrl) => u.periods.find(p => p.period === primary)?.impressions ?? 0
    urls.sort((a, b) => imps(b) - imps(a) || Number(b.isCurrent) - Number(a.isCurrent))

    // skift af dominerende URL mellem perioder
    let switchEvidence = ''
    const dom: { per: string; url: string }[] = []
    for (const per of allPeriods) {
      if (totalsBy(per) < MIN_PERIOD_IMP) continue
      const best = urls.slice().sort((a, b) => (b.periods.find(p => p.period === per)?.impressions ?? 0) - (a.periods.find(p => p.period === per)?.impressions ?? 0))[0]
      dom.push({ per, url: best.url })
    }
    if (new Set(dom.map(d => normUrl(d.url))).size > 1) switchEvidence = `Den URL med flest eksponeringer skifter mellem perioder (${dom.map(d => `${d.per}: ${d.url}`).join(' → ')}).`
    if (ahrefsChange) switchEvidence += (switchEvidence ? ' ' : '') + `Ahrefs: rangerende URL er skiftet fra ${ahrefsChange.prevUrl} til ${ahrefsChange.currUrl}.`

    const material = urls.filter(u => imps(u) >= MIN_URL_IMP && share(u) >= MIN_SHARE)
    const family = material.length >= 2 && material.every((u, i) => i === 0 || material.slice(0, i).some(v => sameFamily(u.url, v.url)))
    const hasGsc = e.gsc.length > 0
    const reasons: string[] = [], uncertainty: string[] = [], checks: string[] = []
    uncertainty.push('Vurderingen bygger kun på URL-mønstre og tal – sidernes indhold, titler og produktmatch er ikke læst.')
    if (!hasGsc) uncertainty.push('Ingen GSC-tal for dette søgeord – kun Ahrefs-observation af rangerende URL.')
    if (allPeriods.length <= 1 || allPeriods.every(p => p === 'ukendt')) uncertainty.push('Kun én eller ukendt periode – skift over tid kan ikke vurderes.')
    if (urls.some(u => u.periods.some(p => p.position != null && p.position > 30))) uncertainty.push('Mindst én URL har gennemsnitsposition over 30 – tallene er svage.')

    let cls: OverlapClass
    if (hasGsc && total < MIN_TOTAL_IMP) { cls = 'utilstraekkeligt'; reasons.push(`Kun ${total} eksponeringer i perioden «${primary}» på tværs af URL'erne (under ${MIN_TOTAL_IMP}) – for få til at kalde overlappet et problem.`) }
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
  const rank: Record<OverlapClass, number> = { 'mulig-kannibalisering': 0, uhensigtsmaessigt: 1, legitimt: 2, begraenset: 3, utilstraekkeligt: 4, ingen: 5 }
  out.sort((a, b) => rank[a.classification] - rank[b.classification] || b.totalImpressions - a.totalImpressions)

  const gscSrc = gsc.length ? { rows: gsc.length, periods: args.gscPeriod?.periods ?? [...new Set(gsc.map(r => r.period))], periodSource: args.gscPeriod?.periodSource ?? 'ukendt', urls: new Set(gsc.map(r => normUrl(r.page))).size, queries: new Set(gsc.map(r => normKeyword(r.query))).size } : null
  const notes = [
    'Tallene er summer af rækkerne i den indlæste fil. GSC-eksporter har rækkegrænser og udelader anonymiserede søgninger, så de kan ikke bruges som komplette totaler for domænet eller en URL uden validering.',
    'Intet her er en anbefaling om sammenlægning, canonical eller redirect. Fælles søgeord alene er ikke grundlag for sådanne ændringer.',
  ]
  const n = (c: OverlapClass) => out.filter(x => x.classification === c).length
  const summary = out.length === 0 ? 'Ingen søgeord med overlap mellem denne side og andre URL\'er i de indlæste data.'
    : `${out.length} søgeord med flere rangerende URL'er inkl. denne side: ${n('legitimt')} legitimt (varianter), ${n('uhensigtsmaessigt')} muligt uhensigtsmæssigt, ${n('mulig-kannibalisering')} mulig kannibalisering, ${n('begraenset') + n('utilstraekkeligt')} med for få data eller begrænset betydning.`
  return { available: true, keywords: out, otherOverlapCount: otherOverlap, sources: { gsc: gscSrc, ahrefs: ah.length ? { rows: ah.length, withPrevCurr: ah.filter(x => x.prevUrl || x.currUrl).length } : null }, notes, summary }
}
