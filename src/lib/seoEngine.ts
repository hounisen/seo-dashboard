// lib/seoEngine.ts
// Regelbaseret beslutningsmotor – én fælles vurderingslogik til score, statusser og anbefalinger.
import { analyzeOverlap, buildPerformance, Performance, PeriodInfo, OverlapResult, GscPageRow, GscPageParse, AhrefsUrlRow, OVERLAP_LABEL } from './overlap'
import { analyzeSerp, SerpAnalysis, SerpData, PageTypeInput, KIND_LABEL } from './serpAnalysis'

export type KwStatus = 'afventer' | 'kandidat' | 'godkendt' | 'fravalgt'

export interface SeoInput {
  url: string
  competitorUrls: string[]
  targetKeyword: string
  semanticKeywords: string[]
  pageTitle: string
  metaDescription: string
  h1: string
  bodyContent: string
  wordCount?: number
  internalLinks?: number
  h2Count?: number
  hasStructuredData?: boolean
  structuredDataTypes?: string[]
  readabilityScore?: 'Høj' | 'Medium' | 'Lav'
  gsc?: GscRow[]
  gscMeta?: { url: string; period: string }
  gscPages?: GscPageRow[]
  gscPagesMeta?: GscPageParse & { periodInfo?: PeriodInfo }
  gscValidationError?: string
  ahrefsUrls?: AhrefsUrlRow[]
  intentFit?: '' | 'match' | 'partial' | 'mismatch'
  businessContext?: string
  pageType?: PageTypeInput
  keywordStatus?: Record<string, 'kandidat' | 'godkendt' | 'fravalgt'>
  serp?: Record<string, SerpData>
  analysisMode?: 'ny' | 'eksisterende'
  b2bOverride?: Record<string, 'match' | 'delvist' | 'ikke'>
  structuredDataVerified?: boolean
  sortimentConfirmed?: Record<string, boolean>
  serpIssues?: Record<string, 'fejl' | 'utilgaengelig'>
  kwData?: { keyword: string; volume: number; difficulty: number | null; intents: string }[]
}

export interface GscRow {
  keyword: string
  impressions: number
  clicks: number
  position: number
}

export type KeywordStatus = 'God' | 'Optimer' | 'Mangler'

export interface KeywordResult {
  keyword: string
  status: KeywordStatus
  currentCount: number
  recommendedMin: number
  recommendedMax: number
  note: string
}

export type Verdict = 'behold' | 'optimer' | 'manuel' | 'ikke-verificeret'

export interface RecommendationItem {
  id: string
  verdict: Verdict
  label: string
  status: 'ok' | 'warn' | 'error' | 'neutral'
  statusLabel: string
  detail: string
  // Fire krævede dele af hver anbefaling
  observation: string
  evidence: string
  meaning: string
  action: string
  // problem = dokumenteret fejl, redaktionel = forbedringsmulighed, laengde = afvigelse fra anbefalet tegnantal
  kind?: 'problem' | 'redaktionel' | 'laengde'
}

export type CriterionVerdict = 'match' | 'delvist' | 'ikke' | 'ikke-vurderet' | 'ikke-verificeret'
export type SerpState = 'ikke-analyseret' | 'ok' | 'tom' | 'utilgaengelig' | 'fejl'
export interface B2BCriterion { key: 'malgruppe' | 'sortiment' | 'intention' | 'landingsside' | 'konvertering'; label: string; verdict: CriterionVerdict; note: string }
export interface B2BAssessment {
  overall: 'MATCH' | 'DELVIST MATCH' | 'IKKE MATCH' | 'IKKE VURDERET'
  basis: 'serp' | 'serp-usikker' | 'estimat'
  basisLabel: string
  criteria: B2BCriterion[]
  summary: string
  overridden: boolean
}
export type KwRole = 'primaer' | 'sekundaer' | 'fravaelg' | 'anden-side' | 'afventer'

export interface FocusCandidate {
  keyword: string
  volume: number | null
  kd: number | null
  intents: string
  context: 'sortiment' | 'afgrænset' | 'ikke-nævnt' | 'ukendt'
  status: KwStatus
  suggested: KwStatus
  rationale: string
  b2b: B2BAssessment
  role: KwRole
  roleReason: string
  provisional: boolean
  alternativeUrl?: string | null
  serpState: SerpState
  serp: { verdict: SerpAnalysis['verdict']; uncertain: boolean; summary: string } | null
  onPage: boolean
}

export interface FocusResult {
  conclusion: 'godkendt' | 'primaer' | 'sidefokus' | 'intet-entydigt' | 'afventer'
  headline: string
  reason: string
  candidates: FocusCandidate[]
  comparable: boolean
  uncompared: string[]
}

export interface ScoreRow {
  group: 'on-page' | 'relevans'
  label: string
  earned: number
  max: number
  note: string
  excluded?: boolean
  bonus?: boolean
}

export interface CoverageItem { label: string; done: boolean; note: string }

export interface ContentGap {
  num: string
  tag: string
  title: string
  description: string
  color: string
}

export interface SeoResult {
  score: number
  maxScore: number
  percentage: number // = on-page-kontrol (automatiske, målbare kontroller)
  keywords: KeywordResult[]
  recommendations: RecommendationItem[]
  contentGaps: ContentGap[]
  quickWins: { priority: 'red' | 'yellow' | 'green'; title: string; detail: string }[]
  wordCount: number
  keywordsFound: number
  keywordsMissing: number
  keywordsOptimise: number
  readabilityScore: 'Høj' | 'Medium' | 'Lav'
  targetKeywordCount: number
  semanticKeywordsCovered: number
  semanticKeywordsTotal: number
  onPageScore: number
  relevanceScore: number | null // kun når et søgeord er GODKENDT
  potentialScore: number | null
  potentialNotes: string[]
  potentialConfidence: 'ingen' | 'lav' | 'ok'
  gscStats: { queries: number; impressions: number }
  verdict: string[]
  scoreBreakdown: ScoreRow[]
  scoreFormula: string
  scoreScope: { included: string[]; excluded: { label: string; reason: string }[] }
  relevanceFormula: string
  coverage: { items: CoverageItem[]; done: number; total: number }
  serpAnalyses: Record<string, SerpAnalysis>
  overlap: OverlapResult
  performance: Performance
  focus: FocusResult
  analysisMode: 'ny' | 'eksisterende'
}

// ── Fleksibel keyword-matching ──────────────────────────────────────────────
// Tolererer store/små bogstaver, stopord imellem ("restauranter i århus"),
// bindestreg/sammenskrivning ("peak flow-måler", "tandlægeudstyr") og bøjningsendelser.
const STOPWORDS = ['i','og','på','af','en','et','de','det','den','til','med','fra','for','er','om','ved','som','der','når','at','men','the','a','an','in','of','and','or','to','with']
const STOP_ALT = STOPWORDS.join('|')

function escapeRe(w: string): string {
  return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildFlexiblePattern(keyword: string): RegExp | null {
  const words = keyword.toLowerCase().trim().split(/[\s-]+/).filter(Boolean)
  if (words.length === 0) return null
  const sep = `(?:[\\s-]+(?:${STOP_ALT})(?:[\\s-]+(?:${STOP_ALT}))?[\\s-]+|[\\s-]*)`
  const body = words.map(escapeRe).join(sep)
  try {
    return new RegExp(`(?<![\\p{L}\\d])${body}[\\p{L}]{0,3}(?![\\p{L}\\d])`, 'giu')
  } catch {
    return null
  }
}

export function countOccurrences(text: string, keyword: string): number {
  if (!text || !keyword) return 0
  const re = buildFlexiblePattern(keyword)
  if (!re) return 0
  const m = text.toLowerCase().match(re)
  return m ? m.length : 0
}

export function containsKeyword(text: string, keyword: string): boolean {
  return countOccurrences(text, keyword) > 0
}

// Fjerner markdown-links/URL'er/billeder, så kun læsbar tekst tælles (ord, keywords)
export function toPlainText(md: string): string {
  return (md || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_>`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Merge all text for scanning
function fullText(input: SeoInput): string {
  return [
    input.pageTitle,
    input.metaDescription,
    input.h1,
    toPlainText(input.bodyContent),
  ].join(' ').toLowerCase()
}

export function expectedCtr(pos: number): number {
  if (pos <= 1.5) return 0.28
  if (pos <= 2.5) return 0.15
  if (pos <= 3.5) return 0.10
  if (pos <= 4.5) return 0.07
  if (pos <= 5.5) return 0.05
  if (pos <= 10.5) return 0.03
  if (pos <= 20.5) return 0.01
  return 0.005
}

function parseContext(ctx: string): { fit: string; limit: string } {
  const text = (ctx || '').replace(/<br\s*\/?>/gi, '\n')
  if (!text.trim()) return { fit: '', limit: '' }
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let fit = '', limit = ''
  let labelled = false
  for (const l of lines) {
    const m = l.match(/^(målgruppe|formål|sortiment|afgrænsning|konvertering)\s*:\s*(.*)$/i)
    if (m) {
      labelled = true
      const k = m[1].toLowerCase()
      if (k === 'afgrænsning') limit += ' ' + m[2]
      else fit += ' ' + m[2]
    }
  }
  if (!labelled) fit = text
  return { fit, limit }
}

function sigWords(keyword: string): string[] {
  return keyword.toLowerCase().split(/[\s-]+/).filter(w => w.length >= 4 && !STOPWORDS.includes(w))
}

function wordHit(text: string, w: string): boolean {
  const t = text.toLowerCase()
  return t.includes(w) || (w.length >= 7 && t.includes(w.slice(0, 6)))
}

function contextMatch(keyword: string, ctx: { fit: string; limit: string }): FocusCandidate['context'] {
  if (!ctx.fit.trim() && !ctx.limit.trim()) return 'ukendt'
  const ws = sigWords(keyword)
  if (ws.length === 0) return 'ukendt'
  const share = (t: string) => ws.filter(w => wordHit(t, w)).length / ws.length
  if (ctx.limit.trim() && share(ctx.limit) >= 0.5) return 'afgrænset'
  if (share(ctx.fit) >= 0.67) return 'sortiment'
  return 'ikke-nævnt'
}

export const normKw = (k: string) => k.toLowerCase().replace(/[\s-]+/g, '')

function computePotential(
  gsc: GscRow[],
  text: string,
  intentFit: SeoInput['intentFit'],
  gscMeta?: { url: string; period: string },
  pageUrl?: string,
): { score: number | null; notes: string[]; confidence: 'ingen' | 'lav' | 'ok'; queries: number; impressions: number } {
  const rows = gsc.filter(r => r.impressions > 0)
  const totalImp = rows.reduce((a, r) => a + r.impressions, 0)
  if (totalImp === 0) return { score: null, notes: [], confidence: 'ingen', queries: 0, impressions: 0 }
  if (totalImp < 100 || rows.length < 5) {
    return {
      score: null,
      notes: [`Utilstrækkelige data: ${rows.length} søgninger og ${totalImp.toLocaleString()} visninger i alt. Der kræves mindst ca. 5 søgninger og 100 visninger, før et potentiale giver mening.`],
      confidence: 'ingen', queries: rows.length, impressions: totalImp,
    }
  }
  const confidence: 'lav' | 'ok' = totalImp < 500 || !gscMeta?.url || !gscMeta?.period ? 'lav' : 'ok'
  const share = (f: (r: GscRow) => boolean) =>
    rows.filter(f).reduce((a, r) => a + r.impressions, 0) / totalImp

  const headroom = share(r => r.position >= 4 && r.position <= 20)
  const ctrGap = share(r => r.impressions >= 20 && r.clicks / r.impressions < 0.6 * expectedCtr(r.position))
  const uncovered = share(r => !containsKeyword(text, r.keyword))

  let raw = ((headroom * 40 + ctrGap * 20 + uncovered * 25) / 85) * 100
  const fitFactor = intentFit === 'match' ? 1 : intentFit === 'partial' ? 0.7 : intentFit === 'mismatch' ? 0.3 : 1
  raw *= fitFactor

  const notes = [
    `${Math.round(headroom * 100)}% af visningerne ligger på placering 4–20 (kan løftes).`,
    `${Math.round(ctrGap * 100)}% af visningerne har lavere CTR end forventet for placeringen.`,
    `${Math.round(uncovered * 100)}% af visningerne kommer fra søgninger, der ikke står på siden.`,
  ]
  notes.push(`Datagrundlag: ${rows.length} søgninger, ${totalImp.toLocaleString()} visninger. URL: ${gscMeta?.url || 'ikke angivet'}. Periode: ${gscMeta?.period || 'ikke angivet'}.`)
  if (!gscMeta?.url || !gscMeta?.period) notes.push('URL og/eller periode for GSC-data er ikke angivet – sikkerheden er sat til lav, og tallet kan ikke tilskrives denne side med sikkerhed.')
  if (gscMeta?.url && pageUrl && normUrl(gscMeta.url) !== normUrl(pageUrl)) notes.push(`Advarsel: GSC-data er angivet for ${gscMeta.url}, men den analyserede side er ${pageUrl}.`)
  if (confidence === 'lav') notes.push('Tallet er usikkert: få visninger i alt.')
  notes.push('Kun søgninger med relevans for sidens formål og målgruppe bør tælle som muligheder – vurdér dem selv.')
  if (intentFit === 'partial') notes.push('Intent delvist match: potentialet er nedvægtet (×0,7).')
  if (intentFit === 'mismatch') notes.push('Intent matcher ikke B2B-målgruppen: potentialet er kraftigt nedvægtet (×0,3).')
  return { score: Math.round(Math.min(raw, 100)), notes, confidence, queries: rows.length, impressions: totalImp }
}


// ── Søgeordsfokus: kandidater, anbefalet status (aldrig automatisk godkendelse) ──────────────
function serpSummary(a: SerpAnalysis): string {
  const parts = Object.entries(a.shares).filter(([k, v]) => k !== 'ukendt' && (v ?? 0) > 0)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
    .map(([k, v]) => `${Math.round((v ?? 0) * a.organicCount)} × ${KIND_LABEL[k as keyof typeof KIND_LABEL].toLowerCase()}`)
  return a.organicCount === 0 ? 'Ingen SERP-data' : `Top ${a.organicCount}: ${parts.join(', ')}`
}

// ── B2B-vurdering pr. søgeord (fem selvstændige kriterier) ───────────────────────────────────
function assessB2B(
  kw: string, intents: string, a: SerpAnalysis | null, pageType: PageTypeInput,
  ctx: { fit: string; limit: string }, override: 'match' | 'delvist' | 'ikke' | undefined,
  serpState: SerpState, volume: number | null, sortimentConfirmed: boolean,
): B2BAssessment {
  const n = a?.organicCount ?? 0
  const serpOk = !!a && n >= 5
  const basis: B2BAssessment['basis'] = serpOk ? (a!.uncertain ? 'serp-usikker' : 'serp') : 'estimat'
  const basisLabel = basis === 'serp' ? 'SERP-understøttet' : basis === 'serp-usikker' ? 'SERP-understøttet, men usikker klassifikation' : 'Foreløbigt estimat – ikke verificeret mod SERP'
  const NV = 'ikke-vurderet' as const
  const unknown = (v: CriterionVerdict) => v === 'ikke-vurderet' || v === 'ikke-verificeret'
  const noSerp = serpState === 'tom'
    ? `Ahrefs returnerede ingen organiske resultater${volume != null && volume > 0 ? ` – selvom Ahrefs viser volumen ${volume}. Det kan ikke forklares med nul søgevolumen; søgebilledet kan ikke bekræftes herfra` : ''}.`
    : serpState === 'utilgaengelig' ? 'SERP-data er utilgængelige (adgang, plan eller kvote) – ikke en vurdering af søgeordet.'
    : serpState === 'fejl' ? 'SERP-kaldet fejlede (API- eller netværksfejl) – prøv igen. Ikke en vurdering af søgeordet.'
    : 'Kræver SERP – klik "Analysér SERP".'
  const crit: B2BCriterion[] = []
  const il = (intents || '').toLowerCase()

  // 1. Målgruppe
  let aud: B2BCriterion
  if (serpOk) {
    const share = a!.b2cSignals / n
    aud = { key: 'malgruppe', label: 'Målgruppe', verdict: share >= 0.4 ? 'ikke' : a!.b2cSignals > 0 ? 'delvist' : 'match',
      note: a!.b2cSignals === 0 ? 'Ingen resultater i top 10 har forbrugersignaler i titlen.' : `${a!.b2cSignals} af ${n} resultater har forbruger-/private-signaler i titlen.` }
  } else aud = { key: 'malgruppe', label: 'Målgruppe', verdict: NV, note: noSerp }
  crit.push(aud)

  // 2. Sortimentsmatch – match på ord, titel og sidetype er kun indikationer.
  //    MATCH kræver, at DU har dokumenteret, at Hounisens faktiske sortiment opfylder søgebehovet.
  const ws = sigWords(kw)
  const hits = (t: string) => ws.length ? ws.filter(w => wordHit(t, w)).length / ws.length : 0
  const fitShare = hits(ctx.fit), limShare = hits(ctx.limit)
  const SL = 'Sortimentsmatch'
  let sor: B2BCriterion
  if (sortimentConfirmed) sor = { key: 'sortiment', label: SL, verdict: 'match', note: 'Bekræftet af dig: Hounisens faktiske sortiment opfylder søgebehovet.' }
  else if (ctx.limit.trim() && limShare >= 0.5) sor = { key: 'sortiment', label: SL, verdict: 'delvist', note: 'Ordene findes i din afgrænsning – kan betyde, at Hounisen ikke leverer det. Vurdér selv.' }
  else if (fitShare >= 0.67) sor = { key: 'sortiment', label: SL, verdict: 'delvist', note: 'Ordoverlap med forretningsbeskrivelsen er kun en indikation. MATCH kræver, at du bekræfter, at sortimentet faktisk opfylder søgebehovet.' }
  else if (!ctx.fit.trim() && !ctx.limit.trim()) sor = { key: 'sortiment', label: SL, verdict: 'ikke-verificeret', note: 'Ingen forretningskontekst angivet.' }
  else sor = { key: 'sortiment', label: SL, verdict: 'ikke-verificeret', note: fitShare > 0 ? 'Kun svagt ordoverlap med forretningsbeskrivelsen – sortimentsmatch er ikke dokumenteret.' : 'Søgningen er ikke nævnt i forretningskonteksten – sortimentsmatch er ikke dokumenteret.' }
  crit.push(sor)

  // 3. Søgeintention
  let int: B2BCriterion
  if (serpOk && a!.dominant !== 'ukendt') {
    const dom = a!.shares[a!.dominant] ?? 0
    const informative = a!.dominant === 'artikel'
    let v: CriterionVerdict
    if (dom < 0.5) v = 'delvist'
    else if (informative) v = pageType === 'artikel' ? 'match' : pageType === '' ? NV : 'ikke'
    else v = pageType === 'artikel' ? 'ikke' : 'match'
    int = { key: 'intention', label: 'Søgeintention', verdict: v, note: `${a!.probableIntent} (${Math.round(dom * 100)} % ${KIND_LABEL[a!.dominant].toLowerCase()}).` }
  } else if (/commercial|transactional/.test(il)) int = { key: 'intention', label: 'Søgeintention', verdict: 'delvist', note: `Foreløbigt: Ahrefs angiver «${intents}». Ikke verificeret mod SERP. ${serpState !== 'ikke-analyseret' ? noSerp : ''}` }
  else if (/informational/.test(il)) int = { key: 'intention', label: 'Søgeintention', verdict: 'delvist', note: `Foreløbigt: Ahrefs angiver «${intents}» (informativ). Ikke verificeret mod SERP.` }
  else int = { key: 'intention', label: 'Søgeintention', verdict: NV, note: `Ingen intent-data. ${noSerp}` }
  crit.push(int)

  // 4. Landingssidematch – konkret funktionelt match, ikke bare "lignende" sidetype
  let lan: B2BCriterion
  if (serpOk && pageType !== '' && a!.compatibleShare !== null) {
    const d = a!.compatibleShare, adj = a!.adjacentShare ?? 0
    const pct = (x: number) => `${Math.round(x * 100)} %`
    let v: CriterionVerdict = d >= 0.5 ? 'match' : d + adj >= 0.3 ? 'delvist' : 'ikke'
    const soft = !!a!.softIntent
    if (v === 'ikke' && soft) v = 'delvist' // informativ/blandet intention giver aldrig automatisk «ikke»
    const alt = a!.ownOtherUrls?.[0]
    const altNote = alt && a!.ownRank == null ? ` En anden eksisterende URL fra samme domæne rangerer i SERP (#${alt.position}: ${alt.url}) – vurdér, om den er en bedre destination.` : ''
    const base = `Direkte samme sidetype som din side (${pageType}): ${pct(d)}. Nærliggende sidetyper med delvist samme funktion: ${pct(adj)}.${soft ? ' Søgeintentionen er informativ eller blandet.' : ''}`
    const why = v === 'match' ? ' Flertallet af resultaterne opfylder samme funktion som din side.'
      : v === 'delvist' ? (soft ? ' Siden kan muligvis dække en del af behovet – SERP er ikke bevis for, at søgeordet hører til en anden side.' : pageType === 'branche' ? ' En branchelandingpage har ikke automatisk samme funktion som kategorisider, produktlister eller forsider – vurdér selv, om din side kan opfylde samme behov.' : ' Kun delvist samme funktion – vurdér selv.') + altNote
      : ' Andre sidetyper dominerer SERP. Det er ikke i sig selv bevis for, at søgeordet hører til en anden side – vurdér, om denne side kan dække en del af behovet.' + altNote
    lan = { key: 'landingsside', label: 'Landingssidematch', verdict: v, note: base + why }
  } else lan = { key: 'landingsside', label: 'Landingssidematch', verdict: NV, note: pageType === '' ? 'Angiv sidetype for at vurdere match.' : noSerp }
  crit.push(lan)

  // 5. Konverteringsrelevans – afledt af de øvrige, aldrig gættet
  const dep = [aud, sor, int]
  let con: B2BCriterion
  if (dep.some(c => c.verdict === 'ikke')) con = { key: 'konvertering', label: 'Konverteringsrelevans', verdict: 'ikke', note: 'Mindst ét grundkriterium (målgruppe, sortiment, intention) er ikke match.' }
  else if (dep.every(c => c.verdict === 'match')) con = { key: 'konvertering', label: 'Konverteringsrelevans', verdict: 'match', note: 'Målgruppe, sortiment og intention matcher. Sandsynlig, men ikke garanteret, B2B-trafik.' }
  else if (dep.every(c => !unknown(c.verdict))) con = { key: 'konvertering', label: 'Konverteringsrelevans', verdict: 'delvist', note: 'Grundkriterierne matcher kun delvist.' }
  else con = { key: 'konvertering', label: 'Konverteringsrelevans', verdict: NV, note: 'Mangler grundlag (målgruppe, sortiment eller intention er ikke vurderet).' }
  crit.push(con)

  const assessed = crit.filter(c => !unknown(c.verdict))
  let overall: B2BAssessment['overall']
  if (assessed.length < 3) overall = 'IKKE VURDERET'
  else if (aud.verdict === 'ikke' || sor.verdict === 'ikke' || int.verdict === 'ikke') overall = 'IKKE MATCH'
  else if (assessed.length >= 4 && assessed.every(c => c.verdict === 'match') && sor.verdict === 'match' && basis === 'serp') overall = 'MATCH'
  else overall = 'DELVIST MATCH'
  let overridden = false
  if (override) { overridden = true; overall = override === 'match' ? 'MATCH' : override === 'delvist' ? 'DELVIST MATCH' : 'IKKE MATCH' }

  const missing = crit.filter(c => unknown(c.verdict)).map(c => c.label.toLowerCase())
  const summary = overridden ? 'Vurdering ændret manuelt af dig.'
    : overall === 'IKKE VURDERET' ? `For få kriterier kan vurderes (${assessed.length} af 5). ${basis === 'estimat' ? noSerp : ''}`
    : `${basis === 'estimat' ? 'Foreløbigt estimat. ' : ''}${assessed.length} af 5 kriterier vurderet${missing.length ? ` (mangler: ${missing.join(', ')})` : ''}.`
  return { overall, basis, basisLabel, criteria: crit, summary, overridden }
}

function matchScore(b: B2BAssessment): number {
  return b.criteria.reduce((s, c) => s + (c.verdict === 'match' ? 2 : c.verdict === 'delvist' ? 1 : 0), 0)
}

function computeFocus(
  input: SeoInput,
  text: string,
  analyses: Record<string, SerpAnalysis>,
): FocusResult {
  const ctx = parseContext(input.businessContext ?? '')
  const names = Array.from(new Set([input.targetKeyword, ...input.semanticKeywords].filter(Boolean)))
  const data = input.kwData ?? []
  const statusMap = input.keywordStatus ?? {}
  const pageType: PageTypeInput = input.pageType ?? ''

  const candidates: FocusCandidate[] = names.map(k => {
    const d = data.find(x => normKw(x.keyword) === normKw(k))
    const context = contextMatch(k, ctx)
    const status: KwStatus = statusMap[normKw(k)] ?? 'afventer'
    const a = analyses[normKw(k)] ?? null
    const volume = d ? d.volume : null
    const serpState: SerpState = a ? (a.organicCount === 0 ? 'tom' : 'ok') : (input.serpIssues?.[normKw(k)] ?? 'ikke-analyseret')
    const b2b = assessB2B(k, d ? d.intents : '', a, pageType, ctx, input.b2bOverride?.[normKw(k)], serpState, volume, !!input.sortimentConfirmed?.[normKw(k)])
    return {
      keyword: k, volume, kd: d ? d.difficulty : null, intents: d ? d.intents : '', context, status,
      suggested: 'afventer' as KwStatus, rationale: '', role: 'afventer' as KwRole, roleReason: '', provisional: false, serpState,
      serp: a ? { verdict: a.verdict, uncertain: a.uncertain, summary: serpSummary(a) } : null,
      b2b, onPage: containsKeyword(text, k), alternativeUrl: a?.ownOtherUrls?.[0]?.url ?? null,
    }
  })

  // Roller. Rangering sker på B2B-match og SERP-match – aldrig på volumen alene.
  const sevenSerp = (c: FocusCandidate) => c.b2b.basis !== 'estimat'
  for (const c of candidates) {
    const o = c.b2b.overall
    const land = c.b2b.criteria.find(x => x.key === 'landingsside')!.verdict
    if (c.status === 'fravalgt') { c.role = 'fravaelg'; c.roleReason = 'Fravalgt af dig.' }
    else if (o === 'IKKE VURDERET') { c.role = 'afventer'; c.roleReason = 'For lidt grundlag til en anbefaling' + (sevenSerp(c) ? '.' : ' – analysér SERP.') }
    else if (o === 'IKKE MATCH') { c.role = 'fravaelg'; c.roleReason = c.b2b.overridden ? 'Du har vurderet søgeordet som ikke match.' : 'Mindst ét grundkriterium (målgruppe, sortiment eller intention) er ikke match.' }
    else if (land === 'ikke' && c.alternativeUrl) { c.role = 'anden-side'; c.roleReason = `Anden eksisterende URL kan være bedre: ${c.alternativeUrl} rangerer i SERP, og andre sidetyper end din dominerer. Vurdér selv – ingen ny side anbefales ud fra SERP alene.` }
    else if (land === 'ikke') { c.role = 'sekundaer'; c.roleReason = 'Andre sidetyper dominerer SERP. Det er ikke dokumentation for, at søgeordet hører til en anden side – vurdér, om denne side kan dække en del af behovet. Indgår ikke som primær kandidat.' }
    else if (!sevenSerp(c)) { c.role = 'afventer'; c.roleReason = 'Foreløbigt estimat – analysér SERP, før søgeordet kan anbefales.' }
    else { c.role = 'sekundaer'; c.roleReason = `${o} ${c.b2b.basis === 'serp' ? 'understøttet af SERP' : 'med usikker SERP-klassifikation'}.` }
  }
  const pool = candidates.filter(c => c.role === 'sekundaer' && c.b2b.criteria.find(x => x.key === 'landingsside')!.verdict !== 'ikke' && c.b2b.basis === 'serp' && ((c.volume ?? 0) > 0 || c.status === 'godkendt'))
  pool.sort((x, y) => matchScore(y.b2b) - matchScore(x.b2b) || (statusMap[normKw(y.keyword)] === 'godkendt' ? 1 : 0) - (statusMap[normKw(x.keyword)] === 'godkendt' ? 1 : 0) || (y.volume ?? 0) - (x.volume ?? 0))
  const best = pool[0]
  const STATE_LABEL: Record<SerpState, string> = { 'ikke-analyseret': 'SERP ikke analyseret', ok: 'SERP analyseret', tom: 'Ahrefs gav ingen SERP-resultater', utilgaengelig: 'SERP-data utilgængelige', fejl: 'SERP-kald fejlede' }
  const uncompared = best ? candidates.filter(c => c !== best && c.role !== 'fravaelg' && (c.b2b.basis === 'estimat' || c.b2b.overall === 'IKKE VURDERET')) : []
  const comparable = uncompared.length === 0
  if (best) {
    best.role = 'primaer'
    best.provisional = !comparable
    best.roleReason = `${!comparable ? 'Foreløbig: ' : ''}Bedste B2B- og SERP-match blandt de kandidater, der kan sammenlignes (${best.b2b.overall}). Rangeret på match, ikke på volumen alene.${best.b2b.overall !== 'MATCH' ? ' Sortimentet er ikke dokumenteret – godkend først efter din egen vurdering.' : ''}${!comparable ? ` Ikke verificeret mod ${uncompared.length} øvrig(e) kandidat(er).` : ''}`
  }

  for (const c of candidates) {
    const why: string[] = []
    if (c.volume != null) why.push(`volumen ${c.volume}${c.kd != null ? `, KD ${c.kd}` : ''}`); else why.push('ingen registreret volumen i de indlæste Ahrefs-data')
    if (c.intents) why.push(`Ahrefs-intent: ${c.intents}`)
    if (c.serp && c.serpState === 'ok') why.push(`SERP: ${c.serp.summary}${c.serp.uncertain ? ' (usikkert)' : ''}`)
    else if (c.serpState !== 'ikke-analyseret') why.push(STATE_LABEL[c.serpState] + (c.serpState === 'tom' && (c.volume ?? 0) > 0 ? ` (Ahrefs viser dog volumen ${c.volume})` : ''))
    why.push(c.roleReason)
    c.rationale = why.join('. ')
    c.suggested = c.role === 'primaer' || c.role === 'sekundaer' ? 'kandidat' : c.role === 'fravaelg' || c.role === 'anden-side' ? 'fravalgt' : 'afventer'
    if (c.keyword === input.targetKeyword && input.intentFit === 'mismatch' && c.suggested !== 'fravalgt') { c.suggested = 'fravalgt'; c.rationale += '. Du har selv vurderet intention som ikke match' }
  }

  const approved = candidates.filter(c => c.status === 'godkendt')
  if (approved.length > 0) {
    return { conclusion: 'godkendt', headline: `Godkendt SEO-fokus: ${approved.map(c => `«${c.keyword}»`).join(', ')}`, reason: 'Du har godkendt søgeordet som SEO-mål. Søgeordsrelaterede kontroller er aktive.', candidates, comparable: true, uncompared: [] }
  }
  if (best) {
    const sec = candidates.filter(c => c.role === 'sekundaer').map(c => `«${c.keyword}»`)
    const other = candidates.filter(c => c.role === 'anden-side').map(c => `«${c.keyword}»`)
    const drop = candidates.filter(c => c.role === 'fravaelg').map(c => `«${c.keyword}»`)
    const parts = [`${best.roleReason}`]
    if (sec.length) parts.push(`Sekundære: ${sec.join(', ')}.`)
    if (other.length) parts.push(`Anden eksisterende URL kan være bedre: ${other.join(', ')}.`)
    if (drop.length) parts.push(`Anbefales fravalgt: ${drop.join(', ')}.`)
    if (!comparable) parts.push(`Kan endnu ikke sammenlignes: ${uncompared.map(c => `«${c.keyword}» (${STATE_LABEL[c.serpState]})`).join(', ')}.`)
    parts.push('Intet er godkendt – status ændres kun af dig.')
    return { conclusion: 'primaer', headline: comparable ? `Anbefalet primær kandidat: «${best.keyword}» (${best.b2b.overall})` : `Foreløbig primær kandidat: «${best.keyword}» (${best.b2b.overall}) – ikke verificeret mod øvrige kandidater`, reason: parts.join(' '), candidates, comparable, uncompared: uncompared.map(c => c.keyword) }
  }
  if (data.length === 0 && Object.keys(analyses).length === 0) {
    return { conclusion: 'afventer', headline: 'Afventer søgedata', reason: 'Upload en Ahrefs keyword-oversigt og/eller analysér SERP, før der foreslås et primært søgeord. Intet søgeord er valgt.', candidates, comparable: false, uncompared: [] }
  }
  const phrase = input.h1 || input.pageTitle
  const withVol = candidates.filter(c => (c.volume ?? 0) > 0 && c.role !== 'fravaelg')
  if (withVol.length === 0 || candidates.some(c => c.role === 'sekundaer')) {
    return { conclusion: 'sidefokus', headline: `Anbefalet sidefokus: «${phrase}»`, reason: 'Ingen kandidat kan anbefales som primært SEO-søgeord ud fra B2B- og SERP-vurderingen. Sidens formulering kan stadig beskrive formålet. Manglende volumen i Ahrefs betyder ikke, at ingen søger.', candidates, comparable: false, uncompared: [] }
  }
  return { conclusion: 'afventer', headline: 'Kandidater afventer SERP-verifikation', reason: `${withVol.map(c => `«${c.keyword}» (${c.volume})`).join(', ')} har volumen, men er ikke SERP-verificeret. Høj volumen alene vælger ikke et primært søgeord – klik "Analysér SERP".`, candidates, comparable: false, uncompared: [] }
}

// ── Hjælpere til anbefalinger ────────────────────────────────────────────────────────────────
function rec(
  id: string, label: string, verdict: Verdict, status: RecommendationItem['status'], statusLabel: string,
  observation: string, evidence: string, meaning: string, action: string, kind?: RecommendationItem['kind'],
): RecommendationItem {
  const detail = `<b>Dokumenteret observation:</b> ${observation}\n<b>Kilde/dokumentation:</b> ${evidence}\n<b>Faglig vurdering:</b> ${meaning}\n<b>Anbefalet handling:</b> ${action}`
  return { id, verdict, label, status, statusLabel, detail, observation, evidence, meaning, action, ...(kind ? { kind } : {}) }
}

const VERDICT_LABEL: Record<Verdict, string> = { behold: 'Behold', optimer: 'Optimér', manuel: 'Manuel vurdering', 'ikke-verificeret': 'Ikke verificeret' }
const VERDICT_STATUS: Record<Verdict, RecommendationItem['status']> = { behold: 'ok', optimer: 'warn', manuel: 'warn', 'ikke-verificeret': 'neutral' }

// Gradueret længdevurdering: god = inden for intervallet, mindre = inden for tolerancen, afvigende = uden for.
export interface LengthGrade { state: 'mangler' | 'god' | 'mindre' | 'afvigende'; dev: number; earned: number }
export function gradeLength(len: number, min: number, max: number, tol: number, maxPts: number): LengthGrade {
  if (len === 0) return { state: 'mangler', dev: min, earned: 0 }
  if (len >= min && len <= max) return { state: 'god', dev: 0, earned: maxPts }
  const dev = len < min ? min - len : len - max
  if (dev <= tol) return { state: 'mindre', dev, earned: Math.max(Math.round(maxPts * (1 - 0.5 * dev / tol)), Math.round(maxPts / 2)) }
  return { state: 'afvigende', dev, earned: Math.max(0, Math.round(maxPts * 0.5 * (1 - (dev - tol) / (2 * tol)))) }
}

function firstSegment(t: string): string {
  return t.split(/\s[|–—-]\s|\|/)[0].trim()
}

function consistency(snippet: string, pageText: string): { share: number; hit: number; total: number } {
  const ws = sigWords(snippet)
  if (ws.length === 0) return { share: 0, hit: 0, total: 0 }
  const hit = ws.filter(w => wordHit(pageText, w)).length
  return { share: hit / ws.length, hit, total: ws.length }
}

function normUrl(u: string): string {
  return (u || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '')
}

export function analyzeSeo(input: SeoInput): SeoResult {
  const plainBody = toPlainText(input.bodyContent)
  const text = fullText(input)
  const pageTextForConsistency = (input.h1 + ' ' + plainBody).toLowerCase()
  const wordCount = input.wordCount ?? plainBody.split(/\s+/).filter(Boolean).length
  const pageType: PageTypeInput = input.pageType ?? ''
  const isNew = input.analysisMode === 'ny'
  const isProduct = pageType === 'produkt'
  const statusMap = input.keywordStatus ?? {}
  const statusOf = (k: string): KwStatus => statusMap[normKw(k)] ?? 'afventer'

  const sentences = plainBody.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  const avgWords = sentences > 0 ? wordCount / sentences : 0
  const readabilityScore: 'Høj' | 'Medium' | 'Lav' = avgWords < 15 ? 'Høj' : avgWords < 22 ? 'Medium' : 'Lav'

  // SERP-analyser pr. søgeord
  const serpAnalyses: Record<string, SerpAnalysis> = {}
  // Kun SERP-målinger for denne analyses egne søgeord indgår – cachede målinger fra andre sider ignoreres
  const currentKeys = new Set([input.targetKeyword, ...input.semanticKeywords].filter(Boolean).map(normKw))
  for (const [k, d] of Object.entries(input.serp ?? {})) if (currentKeys.has(normKw(k))) serpAnalyses[normKw(k)] = analyzeSerp(d, pageType, input.url)

  const focus = computeFocus(input, text, serpAnalyses)

  // ── Godkendt SEO-fokus ──────────────────────────────────────────────────
  const targetApproved = statusOf(input.targetKeyword) === 'godkendt'
  const extrasApproved = input.semanticKeywords.filter(k => statusOf(k) === 'godkendt')
  const kwActive = targetApproved
  const intentFit = input.intentFit || ''

  // ── Målte facts ─────────────────────────────────────────────────────────
  const title = input.pageTitle
  const meta = input.metaDescription
  const titleLen = gradeLength(title.length, 30, 65, 5, 12)
  const metaLen = gradeLength(meta.length, 120, 160, 15, 12)
  const titleGoodLength = titleLen.state === 'god' || titleLen.state === 'mindre'
  const metaGoodLength = metaLen.state === 'god' || metaLen.state === 'mindre'
  const lenNote = (g: LengthGrade, len: number, min: number, max: number) => g.state === 'mindre' ? ` Mindre afvigelse fra anbefalet længde (${len} tegn, anbefalet ${min}–${max}) – ikke et dokumenteret problem; kun relevant, hvis teksten alligevel redigeres.` : ''
  const h1Present = input.h1.length > 0
  const h1Brand = /\s\|\s|®/.test(input.h1)
  const titleHasKw = containsKeyword(title, input.targetKeyword)
  const metaHasKw = containsKeyword(meta, input.targetKeyword)
  const h1HasKw = containsKeyword(input.h1, input.targetKeyword)
  const targetCount = countOccurrences(text, input.targetKeyword)
  const h2Count = input.h2Count ?? (input.bodyContent.match(/^##\s|<h2/gim) || []).length
  let internalLinks = input.internalLinks ?? 0
  if (internalLinks === 0) {
    internalLinks = (input.bodyContent.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length + (input.bodyContent.match(/<a[^>]+href/gi) || []).length
  }
  const sdTypes = input.structuredDataTypes ?? []
  const sdActive = sdTypes.length > 0
  const titleCons = consistency(firstSegment(title), pageTextForConsistency)
  const metaCons = consistency(meta, pageTextForConsistency)
  const titleConsistent = titleCons.total > 0 && titleCons.share >= 0.6
  const metaConsistent = metaCons.total > 0 && metaCons.share >= 0.5

  // GSC-evidens for target (kun brugt som dokumentation, aldrig som mål i sig selv)
  // Ny side: GSC på domæneniveau er kun inspiration – aldrig dokumentation for sidens performance
  // GSC-data: når en forespørgsel × side-fil er indlæst, bruges KUN den aktuelle periode for den analyserede URL.
  const performance = buildPerformance(input.gscPages, input.gscPagesMeta?.periodInfo, input.url, input.gscValidationError)
  const gscBlocked = performance.status === 'valideringsfejl'
  const gscAll: GscRow[] = gscBlocked ? [] : (input.gscPages && input.gscPages.length > 0 && performance.currentLabel
    ? performance.rows.filter(r => r.cur).map(r => ({ keyword: r.keyword, impressions: r.cur!.impressions, clicks: r.cur!.clicks, position: r.cur!.position ?? 0 }))
    : (input.gsc ?? []))
  const gsc = isNew ? [] : gscAll
  const targetGsc = gsc.filter(r => r.impressions > 0 && countOccurrences(r.keyword, input.targetKeyword) > 0).sort((a, b) => b.impressions - a.impressions)[0]
  const gscGood = !!targetGsc && targetGsc.position <= 5 && targetGsc.clicks / targetGsc.impressions >= 0.8 * expectedCtr(targetGsc.position)
  const gscLine = targetGsc ? ` GSC: «${targetGsc.keyword}» ligger på position ${targetGsc.position.toFixed(1)} med ${targetGsc.impressions.toLocaleString()} visninger og ${targetGsc.clicks.toLocaleString()} klik.` : ''

  const unapprovedNote = !kwActive ? ` Søgeordet «${input.targetKeyword}» er ikke godkendt og indgår derfor ikke i vurderingen.` : ''

  // ══ ANBEFALINGER (én fælles logik; status følger altid verdict) ═══════════════
  const recs: RecommendationItem[] = []

  // Title
  if (!title) {
    recs.push(rec('title', 'Title Tag', 'optimer', 'error', 'Optimér', 'Siden har ingen title.', 'Målt i den scrapede side.', 'Uden title vælger Google selv en titel, og brugeren får intet budskab i søgeresultatet.', 'Skriv en title på 30–65 tegn, der beskriver sidens indhold.', 'problem'))
  } else if (titleLen.state === 'afvigende') {
    recs.push(rec('title', 'Title Tag', 'optimer', 'warn', 'Optimér', `Title er ${title.length} tegn (anbefalet 30–65).`, 'Målt tegnantal i den scrapede/redigerede title.', title.length > 65 ? 'Lange titler afkortes i søgeresultatet.' : 'Meget korte titler udnytter ikke pladsen til at beskrive indholdet.', title.length > 65 ? 'Forkort titlen, så vigtigste budskab står først.' : 'Udvid titlen med det, der præcist beskriver siden.', 'laengde'))
  } else if (kwActive && !titleHasKw) {
    recs.push(rec('title', 'Title Tag', 'optimer', 'warn', 'Optimér', `Det godkendte søgeord «${input.targetKeyword}» står ikke i titlen.`, 'Du har godkendt søgeordet; tekstmatch i titlen er målt.', 'Titlen er det tydeligste signal om, hvad siden handler om.', 'Overvej at placere søgeordet (eller en naturlig variant) tidligt i titlen – uden at gøre den unaturlig.', 'redaktionel'))
  } else if (titleConsistent) {
    recs.push(rec('title', 'Title Tag', 'behold', 'ok', 'Behold', `Titlen er ${title.length} tegn og beskriver sidens emne.`, `Titlens ord (${titleCons.hit} af ${titleCons.total}) genfindes i H1/brødtekst.${gscGood ? gscLine : ''}${unapprovedNote}`, 'Titlen matcher sidens faktiske indhold og har passende længde.' + lenNote(titleLen, title.length, 30, 65), 'Behold titlen. Der er ingen dokumenteret grund til at ændre den.'))
  } else {
    recs.push(rec('title', 'Title Tag', 'manuel', 'warn', 'Manuel vurdering', 'Titlens ord genfindes kun delvist i H1/brødtekst.', `Kun ${titleCons.hit} af ${titleCons.total} betydende ord i titlen findes på siden.${unapprovedNote}`, 'Det kan være bevidst (fx brand/formål), men kan også tyde på, at titel og indhold ikke hænger sammen.', 'Vurdér selv, om titlen afspejler sidens indhold og formål.'))
  }

  // H1
  if (!h1Present) {
    recs.push(rec('h1', 'H1', 'optimer', 'error', 'Optimér', 'Siden har ingen H1.', 'Ingen H1 fundet i det scrapede indhold.', 'H1 giver brugere og søgemaskiner et tydeligt emnesignal.', 'Tilføj én H1, der beskriver sidens emne.'))
  } else if (h1Brand) {
    recs.push(rec('h1', 'H1', 'optimer', 'warn', 'Optimér', `H1 indeholder brandnavn eller separator: «${input.h1}».`, 'Målt i den scrapede H1.', 'H1 bør alene beskrive sidens emne; brand hører til i title.', 'Fjern brandnavn/separator fra H1.', 'problem'))
  } else if (kwActive && !h1HasKw) {
    recs.push(rec('h1', 'H1', 'optimer', 'warn', 'Optimér', `Det godkendte søgeord «${input.targetKeyword}» står ikke i H1.`, 'Du har godkendt søgeordet; tekstmatch i H1 er målt.', 'H1 bør afspejle det, siden skal ramme.', 'Overvej en H1, der naturligt indeholder søgeordet eller en variant.'))
  } else {
    recs.push(rec('h1', 'H1', 'behold', 'ok', 'Behold', `H1 er til stede: «${input.h1}».`, `Målt i det scrapede indhold.${unapprovedNote}`, 'H1 beskriver sidens emne uden brand/separator.', 'Behold H1.'))
  }

  // Subheadings
  if (isProduct) {
    recs.push(rec('subheadings', 'Subheadings', 'behold', 'ok', 'Behold', `${h2Count} H2 fundet.`, 'Sidetype er angivet som produktside.', 'Produktsider behøver ikke mange underoverskrifter.', 'Ingen handling.'))
  } else if (h2Count >= 2) {
    recs.push(rec('subheadings', 'Subheadings', 'behold', 'ok', 'Behold', `${h2Count} H2-overskrifter fundet.`, 'Talt i det scrapede indhold.', 'Indholdet er opdelt, så det er let at skimme.', 'Behold strukturen.'))
  } else if (wordCount >= 300) {
    recs.push(rec('subheadings', 'Subheadings', 'optimer', 'warn', 'Optimér', `Kun ${h2Count} H2 på en tekst med ${wordCount} ord.`, 'Talt i det scrapede indhold.', 'Længere tekst uden underoverskrifter er sværere at skimme.', 'Del teksten op med underoverskrifter, der beskriver afsnittenes indhold.'))
  } else {
    recs.push(rec('subheadings', 'Subheadings', 'manuel', 'warn', 'Manuel vurdering', `${h2Count} H2 på en kort tekst (${wordCount} ord).`, 'Talt i det scrapede indhold.', 'Korte tekster behøver ikke nødvendigvis underoverskrifter.', 'Vurdér selv, om teksten har brug for struktur.'))
  }

  // Content (længde dokumenterer aldrig kvalitet alene)
  if (wordCount < 80) {
    recs.push(rec('content', 'Content Length', 'manuel', 'warn', 'Manuel vurdering', `Siden har ~${wordCount} ord reelt indhold.`, 'Talt efter fjernelse af links, produktkort, kontaktlinjer og skabelon.', 'Meget lidt tekst – men en kort side kan være tilstrækkelig, hvis den besvarer brugerens behov.', 'Vurdér selv, om siden besvarer brugerens spørgsmål. Tilføj kun indhold, der dækker et konkret behov.'))
  } else {
    recs.push(rec('content', 'Content Length', 'behold', 'ok', 'Behold', `Siden har ~${wordCount} ord reelt indhold.`, 'Talt efter fjernelse af links, produktkort, kontaktlinjer og skabelon.', 'Ordantal dokumenterer ikke kvalitet alene og indgår kun som en grundkontrol.', 'Ingen handling udløst af længden.'))
  }

  // Links
  if (internalLinks >= 1) {
    recs.push(rec('links', 'Internal Links', 'ikke-verificeret', 'neutral', 'Ikke verificeret', `${internalLinks} link(s) fundet i indholdet.`, 'Antal talt i det scrapede indhold. Destinationerne er ikke undersøgt.', 'Antallet dokumenterer ikke relevans – ét relevant link kan være bedre end mange irrelevante. Relevansen er en faglig vurdering, der kræver, at destinationerne gennemgås.', 'Gennemgå selv, om linkene fører til relevante sider. Ingen handling udløst af antallet.'))
  } else {
    recs.push(rec('links', 'Internal Links', 'manuel', 'warn', 'Manuel vurdering', 'Ingen links fundet i indholdet.', 'Talt i det scrapede indhold.', 'Interne links kan hjælpe brugeren videre, men kun hvis der findes relevante sider. Om der findes sådanne, er en faglig vurdering.', 'Vurdér selv, om der er relevante sider at linke til.'))
  }

  // Meta
  if (!meta) {
    recs.push(rec('meta', 'Meta Description', 'optimer', 'error', 'Optimér', 'Siden har ingen meta description.', 'Ingen meta description fundet.', 'Google vælger selv et uddrag, som sjældent er optimalt.', 'Skriv en beskrivelse på 120–160 tegn, der forklarer, hvad brugeren finder.', 'problem'))
  } else if (metaLen.state === 'afvigende') {
    recs.push(rec('meta', 'Meta Description', 'optimer', 'warn', 'Optimér', `Meta description er ${meta.length} tegn (anbefalet 120–160).`, 'Målt tegnantal.', 'Længden påvirker, om teksten afkortes. Google vælger selv, hvilket snippet der vises, så effekten på CTR kan ikke garanteres.', meta.length > 160 ? 'Forkort beskrivelsen.' : 'Udvid beskrivelsen med en konkret fordel.', 'laengde'))
  } else if (kwActive && !metaHasKw) {
    recs.push(rec('meta', 'Meta Description', 'optimer', 'warn', 'Optimér', `Det godkendte søgeord «${input.targetKeyword}» står ikke i meta description.`, 'Du har godkendt søgeordet; tekstmatch i meta er målt.', 'Fremhævede søgeord kan gøre uddraget mere relevant – men Google kan vælge et andet snippet.', 'Overvej at nævne søgeordet naturligt.', 'redaktionel'))
  } else if (metaConsistent) {
    recs.push(rec('meta', 'Meta Description', 'behold', 'ok', 'Behold', `Meta description er ${meta.length} tegn og beskriver siden.`, `Beskrivelsens ord (${metaCons.hit} af ${metaCons.total}) genfindes på siden.${gscGood ? gscLine : ''}${unapprovedNote}`, 'Beskrivelsen er relevant og har passende længde. Google vælger selv snippet, så effekt på CTR kan ikke garanteres.' + lenNote(metaLen, meta.length, 120, 160), 'Behold meta description. Ændr den ikke alene for at nå et højere score.'))
  } else {
    recs.push(rec('meta', 'Meta Description', 'manuel', 'warn', 'Manuel vurdering', 'Meta descriptions ord genfindes kun delvist på siden.', `Kun ${metaCons.hit} af ${metaCons.total} betydende ord findes på siden.${unapprovedNote}`, 'Beskrivelsen lover måske noget andet end siden indeholder.', 'Vurdér selv, om beskrivelsen passer til sidens indhold.'))
  }

  // FAQ (brugerindhold – FAQ rich results er udfaset af Google)
  const hasFaq = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a)/i.test((plainBody + ' ' + input.h1 + ' ' + title).toLowerCase())
  recs.push(rec('faq', 'FAQ Section', 'behold', 'ok', 'Behold', hasFaq ? 'FAQ-sektion fundet.' : 'Ingen FAQ-sektion.', 'Søgt i det scrapede indhold.', 'FAQ er nyttigt for brugerne, hvis kunderne reelt stiller spørgsmålene. Google har udfaset FAQ rich results, så FAQPage JSON-LD er ikke længere et SEO-tiltag.', 'Ingen handling.'))

  // Structured data
  const sdVerified = sdActive && !!input.structuredDataVerified
  recs.push(sdVerified
    ? rec('structured-data', 'Structured Data', 'behold', 'ok', `Verificeret: ${sdTypes.join(', ')}`, `Du har oplyst ${sdTypes.join(', ')} og bekræftet, at markup er verificeret i Rich Results Test.`, 'Oplyst og bekræftet af dig – værktøjet læser ikke selv sidens markup.', 'Verificeret markup kan give rige visninger.', 'Ingen handling.')
    : sdActive
      ? rec('structured-data', 'Structured Data', 'ikke-verificeret', 'neutral', `Manuelt oplyst: ${sdTypes.join(', ')}`, `Du har manuelt oplyst: ${sdTypes.join(', ')}. Markup er ikke verificeret.`, 'Oplyst manuelt af dig – værktøjet læser ikke sidens markup, og oplysningen giver ingen point.', 'Manuelt oplyst markup kan være ugyldigt eller mangle på siden.', 'Verificér i Rich Results Test (https://search.google.com/test/rich-results), og bekræft i formularen.')
      : rec('structured-data', 'Structured Data', 'ikke-verificeret', 'neutral', 'Ikke verificeret', 'Sidens markup er ikke undersøgt.', 'Værktøjet læser ikke sidens markup.', 'Der kan hverken konkluderes fejl eller mangler.', 'Tjek i Rich Results Test og markér de typer, siden har.'))

  // URL-overlap / mulig kannibalisering (påvirker aldrig score)
  const serpKinds: Record<string, string> = {}
  for (const [k, a] of Object.entries(serpAnalyses)) if (a.status === 'ok') serpKinds[k] = KIND_LABEL[a.dominant].toLowerCase()
  const overlap = analyzeOverlap({ pageUrl: input.url, gscPages: input.gscPages, gscPeriod: input.gscPagesMeta, ahrefsUrls: input.ahrefsUrls, keywords: [input.targetKeyword, ...input.semanticKeywords], serpKinds })
  if (overlap.available) {
    const serious = overlap.keywords.filter(x => x.classification === 'mulig-kannibalisering' || x.classification === 'uhensigtsmaessigt')
    const legit = overlap.keywords.filter(x => x.classification === 'legitimt')
    const per = overlap.sources.gsc ? overlap.sources.gsc.periods.join(', ') : 'ingen GSC-periode'
    const obs = `${overlap.summary} Periode: ${per}. Kilde: ${[overlap.sources.gsc ? 'GSC (forespørgsel × side)' : '', overlap.sources.ahrefs ? 'Ahrefs (rangerende URL\'er)' : ''].filter(Boolean).join(' + ')}.`
    if (serious.length > 0) recs.push(rec('overlap', 'URL-overlap', 'manuel', 'warn', 'Manuel vurdering', obs, 'Tal fra de indlæste filer; sidernes indhold og intention er ikke læst.', 'Fælles søgeord er ikke i sig selv et problem. Om overlappet skader, afhænger af sidernes intention og produktmatch.', 'Gennemgå de markerede søgeord manuelt. Sammenlæg, canonical eller redirect anbefales ikke ud fra dette alene.', 'redaktionel'))
    else if (legit.length > 0) recs.push(rec('overlap', 'URL-overlap', 'behold', 'ok', 'Behold', obs, 'Tal fra de indlæste filer.', 'Overlappet ligner normal variantoverlap mellem produktsider.', 'Ingen handling.'))
    else recs.push(rec('overlap', 'URL-overlap', 'ikke-verificeret', 'neutral', 'Ikke verificeret', obs, 'Tal fra de indlæste filer.', 'For få eksponeringer eller data til at vurdere overlappet. Det er ikke et dokumenteret problem.', 'Ingen handling.'))
  }

  // Søgeordsfokus
  if (kwActive) {
    if (targetCount === 0) {
      recs.push(rec('focus', 'Godkendt søgeord', 'optimer', 'warn', 'Optimér', `«${input.targetKeyword}» findes ikke på siden.`, 'Godkendt af dig; flexibelt tekstmatch (inkl. bøjning og sammensatte ord).', 'Et godkendt SEO-mål bør være dækket i siden.', 'Dæk søgeordet naturligt i title, H1 eller brødtekst.'))
    } else {
      recs.push(rec('focus', 'Godkendt søgeord', 'behold', 'ok', 'Behold', `«${input.targetKeyword}» findes ${targetCount} gang(e) på siden.`, 'Godkendt af dig; flexibelt tekstmatch.', 'Søgeordet er dækket. Der er ingen fast målværdi for antal forekomster.', 'Ingen handling.'))
    }
  } else {
    recs.push(rec('focus', 'SEO-søgeord', 'ikke-verificeret', 'neutral', 'Ikke verificeret', `Intet SEO-søgeord er godkendt (analyseret: «${input.targetKeyword}»).`, 'Søgeordsstatus er AFVENTER/KANDIDAT/FRAVALGT.', 'Søgeordsrelaterede kontroller er derfor ikke aktive og indgår ikke i scoren.', `${focus.headline}. Vurdér kandidaterne under Keywords → Søgeordsfokus (B2B-vurdering, SERP, volumen), og godkend først, når du har verificeret dem.`))
  }

  if (intentFit) {
    recs.push(rec('intent', 'Søgeintention / B2B-match', intentFit === 'match' ? 'behold' : 'manuel', intentFit === 'match' ? 'ok' : 'warn', intentFit === 'match' ? 'Behold' : 'Manuel vurdering', `Du har vurderet intention som: ${intentFit === 'match' ? 'match' : intentFit === 'partial' ? 'delvist match' : 'ikke match'}.`, 'Din egen vurdering.', intentFit === 'match' ? 'Forbedringer har størst effekt, når intentionen passer.' : 'Tekstoptimering kan ikke rette et intent-mismatch.', intentFit === 'match' ? 'Ingen handling.' : 'Overvej, om siden er den rigtige til søgningen, før du optimerer den.'))
  }

  // Status følger altid verdict (undtagen "error" ved manglende element, og structured data-label)
  for (const r of recs) {
    if (r.status !== 'error') r.status = VERDICT_STATUS[r.verdict]
    if (r.status !== 'error' && !/^(Aktiv|Manuelt oplyst|Verificeret)/.test(r.statusLabel)) r.statusLabel = VERDICT_LABEL[r.verdict]
  }

  // ══ SCORE (tre adskilte dele) ════════════════════════════════════════════════
  // 1) Automatisk on-page-kontrol: kun målbare, strukturelle forhold. Ingen søgeord, ingen længdebonus.
  const consPts = titleConsistent ? 10 : 0
  const metaConsPts = metaConsistent ? 5 : 0
  const contentPts = wordCount >= (isProduct ? 80 : 150) ? 10 : 0
  const h2Pts = isProduct ? 10 : h2Count >= 2 ? 10 : h2Count >= 1 ? 5 : 0
  const breakdown: ScoreRow[] = [
    { group: 'on-page', label: 'Title til stede', earned: title ? 8 : 0, max: 8, note: title ? 'Fundet' : 'Mangler' },
    { group: 'on-page', label: 'Title: længde 30–65 tegn', earned: titleLen.earned, max: 12, note: `${title.length} tegn${titleLen.state === 'mindre' ? ' – mindre afvigelse, delvise point' : titleLen.state === 'afvigende' ? ' – afviger tydeligt' : ''}` },
    { group: 'on-page', label: 'Meta description til stede', earned: meta ? 8 : 0, max: 8, note: meta ? 'Fundet' : 'Mangler' },
    { group: 'on-page', label: 'Meta: længde 120–160 tegn', earned: metaLen.earned, max: 12, note: `${meta.length} tegn${metaLen.state === 'mindre' ? ' – mindre afvigelse, delvise point' : metaLen.state === 'afvigende' ? ' – afviger tydeligt' : ''}` },
    { group: 'on-page', label: 'H1 til stede', earned: h1Present ? 15 : 0, max: 15, note: h1Present ? 'Fundet' : 'Mangler' },
    { group: 'on-page', label: 'Underoverskrifter', earned: h2Pts, max: 10, note: isProduct ? 'Produktside – fuld værdi' : `${h2Count} H2` },
    { group: 'on-page', label: 'Indhold til stede', earned: contentPts, max: 10, note: `${wordCount} ord (grundkontrol, ikke kvalitetsmål)` },
    { group: 'on-page', label: 'Interne links til stede', earned: internalLinks >= 1 ? 10 : 0, max: 10, note: `${internalLinks} fundet (grundkontrol)` },
    { group: 'on-page', label: 'Title passer til sidens indhold', earned: consPts, max: 10, note: titleCons.total ? `${titleCons.hit}/${titleCons.total} ord genfundet` : 'Intet at sammenligne' },
    { group: 'on-page', label: 'Meta passer til sidens indhold', earned: metaConsPts, max: 5, note: metaCons.total ? `${metaCons.hit}/${metaCons.total} ord genfundet` : 'Intet at sammenligne' },
    { group: 'on-page', label: 'Struktureret data (bonus, kun verificeret)', earned: sdVerified ? 5 : 0, max: 5, bonus: true, note: sdVerified ? 'Verificeret og bekræftet af dig' : sdActive ? 'Manuelt oplyst, ikke verificeret – giver ingen point' : 'Ikke undersøgt – tæller hverken for eller imod' },
  ]
  // 2) SEO-relevans: kun for GODKENDTE søgeord. Ellers udeladt (påvirker aldrig on-page-scoren).
  const exNote = `Udeladt – «${input.targetKeyword}» er ikke godkendt`
  const densPts = targetCount >= 3 ? 15 : targetCount === 2 ? 11 : targetCount === 1 ? 6 : 0
  const extraCovered = extrasApproved.filter(k => countOccurrences(text, k) >= 1).length
  breakdown.push(
    { group: 'relevans', label: 'Godkendt søgeord i title', earned: titleHasKw ? 10 : 0, max: 10, excluded: !kwActive, note: kwActive ? (titleHasKw ? 'Fundet' : 'Ikke fundet') : exNote },
    { group: 'relevans', label: 'Godkendt søgeord i meta', earned: metaHasKw ? 8 : 0, max: 8, excluded: !kwActive, note: kwActive ? (metaHasKw ? 'Fundet' : 'Ikke fundet') : exNote },
    { group: 'relevans', label: 'Godkendt søgeord i H1', earned: h1HasKw ? 5 : 0, max: 5, excluded: !kwActive, note: kwActive ? (h1HasKw ? 'Fundet' : 'Ikke fundet') : exNote },
    { group: 'relevans', label: 'Godkendt søgeord i teksten', earned: densPts, max: 15, excluded: !kwActive, note: kwActive ? `${targetCount} forekomst(er) – ingen fast målværdi` : exNote },
    { group: 'relevans', label: 'Øvrige godkendte søgeord dækket', earned: extrasApproved.length ? Math.round((extraCovered / extrasApproved.length) * 20) : 0, max: 20, excluded: !kwActive || extrasApproved.length === 0, note: extrasApproved.length ? `${extraCovered} af ${extrasApproved.length}` : 'Ingen øvrige godkendte søgeord' },
  )
  const sum = (rows: ScoreRow[]) => rows.reduce((a, r) => a + r.earned, 0)
  const onPageRows = breakdown.filter(r => r.group === 'on-page')
  const onPageRaw = sum(onPageRows)
  const onPageDenom = onPageRows.filter(r => !r.bonus).reduce((a, r) => a + r.max, 0)
  const onPageCapped = Math.min(onPageRaw, onPageDenom) // aldrig over 100 mulige point
  const percentage = Math.min(Math.max(Math.round((onPageCapped / onPageDenom) * 100), 0), 100)
  const relRows = breakdown.filter(r => r.group === 'relevans' && !r.excluded)
  const relDenom = relRows.reduce((a, r) => a + r.max, 0)
  const relevanceScore = kwActive && relDenom > 0 ? Math.round((sum(relRows) / relDenom) * 100) : null
  const scoreFormula = `On-page-kontrol: ${onPageCapped} point af ${onPageDenom} mulige = ${percentage} % (kun automatiske, målbare kontroller)`
  const relevanceFormula = relevanceScore === null ? 'SEO-relevans: ikke beregnet – ingen godkendt søgeord' : `SEO-relevans: ${sum(relRows)} point af ${relDenom} mulige = ${relevanceScore} % (kun for godkendte søgeord)`

  // 3) Potentiale (GSC)
  const potMeta = performance.currentLabel ? { url: input.url, period: performance.currentLabel } : input.gscMeta
  const potential = isNew
    ? { score: null as number | null, notes: ['Ny side: potentiale beregnes ikke ud fra GSC. Manglende URL-historik er ikke et negativt signal.'], confidence: 'ingen' as 'ingen' | 'lav' | 'ok', queries: 0, impressions: 0 }
    : gscBlocked
      ? { score: null as number | null, notes: [`Datavalideringsfejl: ${performance.error} Performanceberegninger (potentiale, CTR-analyse, klikestimater) er stoppet.`], confidence: 'ingen' as 'ingen' | 'lav' | 'ok', queries: 0, impressions: 0 }
      : computePotential(gsc, text, intentFit, potMeta, input.url)
  if (!isNew && !gscBlocked && performance.currentLabel) {
    if (performance.currentLabel) potential.notes.push(`Beregnet ud fra den aktuelle periode (${performance.currentLabel}) for denne URL.`)
    const t = performance.totals
    if (t.cur && t.prev) potential.notes.push(`Udvikling (${performance.previousLabel} → ${performance.currentLabel}): klik ${t.prev.clicks.toLocaleString('da-DK')} → ${t.cur.clicks.toLocaleString('da-DK')}, eksponeringer ${t.prev.impressions.toLocaleString('da-DK')} → ${t.cur.impressions.toLocaleString('da-DK')} (summer af filens rækker, ikke validerede totaler).`)
    potential.notes.push('Potentialet er et indikatortal ud fra placering og CTR – ikke et dokumenteret trafikpotentiale. Klikestimater er teoretiske.')
  }


  // ── Søgeords-tabel ──────────────────────────────────────────────────────
  const allKeywords = [input.targetKeyword, ...input.semanticKeywords].filter(Boolean)
  const keywordResults: KeywordResult[] = allKeywords.map(kw => {
    const count = countOccurrences(text, kw)
    const st = statusOf(kw)
    const stNote = st === 'godkendt' ? 'Godkendt' : st === 'fravalgt' ? 'Fravalgt – påvirker ikke score' : st === 'kandidat' ? 'Kandidat – påvirker ikke score' : 'Afventer – påvirker ikke score'
    const cand = focus.candidates.find(c => normKw(c.keyword) === normKw(kw))
    const roleNote = cand && (cand.role === 'anden-side' || cand.role === 'fravaelg') ? ' · bør ikke tilføjes denne side' : ''
    return { keyword: kw, status: count === 0 ? 'Mangler' : 'God', currentCount: count, recommendedMin: 1, recommendedMax: 0, note: `${count === 0 ? 'Ikke fundet' : 'Fundet'} · ${stNote}${roleNote}` }
  })
  const keywordsFound = keywordResults.filter(k => k.status === 'God').length
  const keywordsMissing = keywordResults.filter(k => k.status === 'Mangler').length
  const semanticCovered = input.semanticKeywords.filter(k => statusOf(k) !== 'fravalgt' && countOccurrences(text, k) >= 1).length

  // ── Analysegrundlag ─────────────────────────────────────────────────────
  const targetSerp = serpAnalyses[normKw(input.targetKeyword)]
  const approvedSerp = [input.targetKeyword, ...extrasApproved].some(k => serpAnalyses[normKw(k)] && serpAnalyses[normKw(k)].organicCount >= 5)
  const gscEnough = potential.confidence === 'ok' || potential.confidence === 'lav'
  const gscVerified = gscEnough && !!(potMeta?.url || potMeta?.period)
  const coverageItems: CoverageItem[] = [
    { label: 'Title, meta og H1 målt', done: !!(title || meta || input.h1), note: 'Fra scrape/redigering' },
    { label: 'Indhold renset og talt', done: wordCount > 0, note: `${wordCount} ord` },
    { label: 'Sidetype angivet', done: pageType !== '', note: pageType || 'Ikke angivet' },
    { label: 'Forretningskontekst angivet', done: !!(input.businessContext || '').trim(), note: (input.businessContext || '').trim() ? 'Angivet' : 'Ikke angivet' },
    { label: 'Søgeord godkendt', done: kwActive, note: kwActive ? input.targetKeyword : 'Intet godkendt søgeord' },
    { label: 'Ahrefs søgedata indlæst', done: (input.kwData ?? []).length > 0, note: (input.kwData ?? []).length ? `${(input.kwData ?? []).length} søgeord` : 'Ikke indlæst' },
    { label: 'SERP verificeret', done: approvedSerp || (!!targetSerp && targetSerp.organicCount >= 5), note: targetSerp ? `${targetSerp.organicCount} resultater (${targetSerp.dataDate ? targetSerp.dataDate.slice(0, 10) : 'dato ukendt'})` : 'Ikke analyseret' },
    ...(isNew ? [] : [{ label: 'GSC-data tilstrækkelige og tilknyttet URL/periode', done: gscVerified, note: gsc.length === 0 ? 'Ikke indlæst' : gscVerified ? 'Tilstrækkelige' : 'Utilstrækkelige eller URL/periode mangler' }]),
    { label: 'B2B-vurdering SERP-understøttet', done: focus.candidates.some(c => c.b2b.basis === 'serp' && c.b2b.overall !== 'IKKE VURDERET'), note: focus.candidates.some(c => c.b2b.basis !== 'estimat') ? 'Mindst ét søgeord' : 'Kun foreløbige estimater' },
    { label: 'Structured data verificeret', done: sdVerified, note: sdVerified ? 'Verificeret og bekræftet af dig' : sdActive ? 'Kun manuelt oplyst' : 'Ikke undersøgt' },
  ]
  const coverageDone = coverageItems.filter(c => c.done).length

  // ── Samlet vurdering ────────────────────────────────────────────────────
  const verdict: string[] = []
  const nOpt = recs.filter(r => r.verdict === 'optimer').length
  const nBeh = recs.filter(r => r.verdict === 'behold').length
  const nMan = recs.filter(r => r.verdict === 'manuel').length
  const nIkke = recs.filter(r => r.verdict === 'ikke-verificeret').length
  const titleRec = recs.find(r => r.id === 'title')!
  const metaRec = recs.find(r => r.id === 'meta')!
  if (titleRec.verdict === 'behold' && metaRec.verdict === 'behold') verdict.push('Behold den eksisterende title og meta description.')
  else if (titleRec.verdict === 'behold') verdict.push('Behold den eksisterende title.')
  else if (metaRec.verdict === 'behold') verdict.push('Behold den eksisterende meta description.')
  verdict.push(nOpt === 0 ? 'Ingen dokumenterede problemer i de undersøgte forhold.' : `${nOpt} dokumenteret(e) forbedringsmulighed(er) – se Anbefalinger.`)
  if (nMan + nIkke > 0) verdict.push(`${nMan} kræver manuel vurdering, ${nIkke} er ikke verificeret.`)
  if (focus.conclusion !== 'afventer') verdict.push(focus.headline + '.')
  if (gsc.length > 0 && potential.confidence === 'ingen') verdict.push('GSC-data er utilstrækkelige til at pege på nye muligheder.')
  if (isNew) verdict.push('Ny side: analysen bygger på indhold, forretningskontekst, Ahrefs og SERP. Manglende URL-historik er ikke et negativt signal.')
  else if (gscBlocked) verdict.push('Datavalideringsfejl i GSC-perioderne – performanceberegninger er stoppet.')
  else if (gsc.length > 0 && (!potMeta?.url || !potMeta?.period)) verdict.push('GSC-data mangler angivelse af URL og/eller periode – muligheder kan ikke tilskrives siden med sikkerhed.')
  verdict.push(`Delvis analyse: ${coverageDone} af ${coverageItems.length} forhold er undersøgt – scoren er ikke en samlet SEO-vurdering.`)
  void nBeh

  // ── Content gaps ────────────────────────────────────────────────────────
  const noExpand = new Set(focus.candidates.filter(c => c.role === 'anden-side' || c.role === 'fravaelg').map(c => normKw(c.keyword)))
  const missingKeywords = keywordResults.filter(k => k.status === 'Mangler' && !noExpand.has(normKw(k.keyword))).map(k => k.keyword)
  const gscMissing = gsc.filter(r => r.impressions >= 10 && !containsKeyword(text, r.keyword)).sort((a, b) => b.impressions - a.impressions).map(r => r.keyword)
  const contentGaps: ContentGap[] = [
    (gsc.length > 0 && potential.confidence === 'ingen')
      ? { num: 'Gap 01 · Manglende dækning', tag: '#ff7043', title: `${gsc.length} forespørgsler registreret`, description: 'Utilstrækkelige data til anbefalinger.', color: '#ff7043' }
      : { num: 'Gap 01 · Manglende dækning', tag: '#ff7043', title: (missingKeywords.length + gscMissing.length) > 0 ? `${missingKeywords.length} keywords + ${gscMissing.length} GSC-søgninger ikke fundet` : 'Semantisk dækning', description: (missingKeywords.length + gscMissing.length) > 0 ? `Ikke fundet: ${[...missingKeywords, ...gscMissing].slice(0, 5).join(', ')}. At noget ikke står på siden er ikke i sig selv et problem – vurdér relevans først.` : 'Alle valgte keywords og GSC-søgninger er dækket.', color: '#ff7043' },
    { num: 'Gap 02 · Intention', tag: '#4f7fff', title: targetSerp ? `SERP: ${serpSummary(targetSerp)}` : 'SERP ikke analyseret', description: targetSerp ? targetSerp.reasons.join(' ') : 'Klik "Analysér SERP" under Keywords for at se, hvilke sidetyper der rangerer – eller tjek top 10 manuelt.', color: '#4f7fff' },
    { num: 'Gap 03 · Strukturerede data', tag: '#2dce89', title: sdVerified ? 'Structured data verificeret' : sdActive ? 'Structured data manuelt oplyst' : 'Structured data ikke undersøgt', description: sdActive ? (sdVerified ? 'Bekræftet af dig som verificeret i Rich Results Test.' : 'Manuelt oplyst, ikke verificeret. Verificér i Rich Results Test, og bekræft i formularen.') : 'Værktøjet kan ikke se sidens markup. Tjek i Rich Results Test, før du konkluderer, at noget mangler.', color: '#2dce89' },
  ]

  // ── Quick wins: kun dokumenterede OPTIMÉR-fund (maks. 3) + behold-besked ─────────
  const quickWins: SeoResult['quickWins'] = []
  for (const r of recs.filter(x => x.verdict === 'optimer').slice(0, 3)) {
    quickWins.push({ priority: r.status === 'error' ? 'red' : 'yellow', title: `${r.label}: ${r.observation}`, detail: r.action })
  }
  if (titleRec.verdict === 'behold' || metaRec.verdict === 'behold') {
    quickWins.push({ priority: 'green', title: `Behold ${titleRec.verdict === 'behold' && metaRec.verdict === 'behold' ? 'title og meta' : titleRec.verdict === 'behold' ? 'title' : 'meta'} uændret`, detail: 'Elementet er relevant og præcist ift. sidens indhold. Lad det, der virker, være i fred.' })
  }
  if (potential.confidence !== 'ingen' && gsc.length > 0 && gscMissing.length > 0) {
    quickWins.push({ priority: 'yellow', title: 'Hypotese: vurdér GSC-søgninger, der ikke står på siden', detail: `${gscMissing.slice(0, 3).join(', ')} – kun hypotese. Tilføj kun, hvis det passer til sortiment, målgruppe og sidens formål.` })
  } else if (gsc.length > 0 && potential.confidence === 'ingen') {
    quickWins.push({ priority: 'green', title: 'GSC-data er utilstrækkelige', detail: 'For få visninger til at udpege muligheder. Brug en længere periode eller flere søgninger.' })
  }

  if (isNew && gscAll.length > 0) {
    const insp = gscAll.filter(r => r.impressions >= 10 && !containsKeyword(text, r.keyword)).sort((a, b) => b.impressions - a.impressions).slice(0, 4).map(r => r.keyword)
    if (insp.length) quickWins.push({ priority: 'yellow', title: 'Inspiration fra GSC (domæneniveau)', detail: `${insp.join(', ')} – kun inspiration til søgeordskandidater, ikke dokumentation for sidens performance. Vurdér B2B-match og SERP, før noget bruges.` })
  }

  return {
    score: onPageCapped,
    maxScore: 100,
    percentage,
    keywords: keywordResults,
    recommendations: recs,
    contentGaps,
    quickWins,
    wordCount,
    keywordsFound,
    keywordsMissing,
    keywordsOptimise: 0,
    readabilityScore,
    targetKeywordCount: targetCount,
    semanticKeywordsCovered: semanticCovered,
    semanticKeywordsTotal: input.semanticKeywords.length,
    onPageScore: percentage,
    relevanceScore,
    potentialScore: potential.score,
    potentialNotes: potential.notes,
    potentialConfidence: potential.confidence,
    gscStats: { queries: potential.queries, impressions: potential.impressions },
    verdict,
    scoreBreakdown: breakdown,
    scoreFormula,
    scoreScope: {
      included: breakdown.filter(r => r.group === 'on-page' && !r.bonus).map(r => `${r.label} (maks. ${r.max})`),
      excluded: [
        ...(sdVerified ? [] : [{ label: 'Struktureret data (bonus, +5)', reason: sdActive ? 'Kun manuelt oplyst – bonus kræver, at du bekræfter verificering' : 'Ikke undersøgt' }]),
        { label: 'Søgeordsrelevans', reason: kwActive ? 'Beregnes separat som SEO-relevans' : 'Intet godkendt søgeord' },
        { label: 'SERP-, B2B- og GSC-vurderinger', reason: 'Indgår ikke i on-page-scoren – de påvirker kun anbefalinger og søgeordsstatus' },
      ],
    },
    relevanceFormula,
    coverage: { items: coverageItems, done: coverageDone, total: coverageItems.length },
    serpAnalyses,
    overlap,
    performance,
    focus,
    analysisMode: isNew ? 'ny' : 'eksisterende',
  }
}
