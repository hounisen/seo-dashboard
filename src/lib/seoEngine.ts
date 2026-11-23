// lib/seoEngine.ts
// Regelbaseret beslutningsmotor – én fælles vurderingslogik til score, statusser og anbefalinger.
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
  intentFit?: '' | 'match' | 'partial' | 'mismatch'
  businessContext?: string
  pageType?: PageTypeInput
  keywordStatus?: Record<string, 'kandidat' | 'godkendt' | 'fravalgt'>
  serp?: Record<string, SerpData>
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
}

export interface FocusCandidate {
  keyword: string
  volume: number | null
  kd: number | null
  intents: string
  context: 'sortiment' | 'afgrænset' | 'ikke-nævnt' | 'ukendt'
  status: KwStatus
  suggested: KwStatus
  rationale: string
  serp: { verdict: SerpAnalysis['verdict']; uncertain: boolean; summary: string } | null
  onPage: boolean
}

export interface FocusResult {
  conclusion: 'godkendt' | 'primaer' | 'sidefokus' | 'intet-entydigt' | 'afventer'
  headline: string
  reason: string
  candidates: FocusCandidate[]
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
  relevanceFormula: string
  coverage: { items: CoverageItem[]; done: number; total: number }
  serpAnalyses: Record<string, SerpAnalysis>
  focus: FocusResult
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

function computeFocus(
  input: SeoInput,
  text: string,
  analyses: Record<string, SerpAnalysis>,
): FocusResult {
  const ctx = parseContext(input.businessContext ?? '')
  const names = Array.from(new Set([input.targetKeyword, ...input.semanticKeywords].filter(Boolean)))
  const data = input.kwData ?? []
  const statusMap = input.keywordStatus ?? {}

  const candidates: FocusCandidate[] = names.map(k => {
    const d = data.find(x => normKw(x.keyword) === normKw(k))
    const context = contextMatch(k, ctx)
    const status: KwStatus = statusMap[normKw(k)] ?? 'afventer'
    const a = analyses[normKw(k)] ?? null
    const volume = d ? d.volume : null
    let suggested: KwStatus = 'afventer'
    const why: string[] = []
    if (volume != null) why.push(`volumen ${volume}${d && d.difficulty != null ? `, KD ${d.difficulty}` : ''}`)
    else why.push('ingen registreret volumen i de indlæste Ahrefs-data')
    if (d && d.intents) why.push(`Ahrefs-intent: ${d.intents}`)
    if (context === 'sortiment') why.push('sprogligt overlap med forretningsbeskrivelsen (kun indikation)')
    if (context === 'afgrænset') why.push('sprogligt overlap med afgrænsningen (kun indikation – vurdér manuelt)')
    if (a) {
      why.push(`SERP: ${serpSummary(a)}${a.uncertain ? ' (usikkert)' : ''}`)
      if (a.verdict === 'fravaelg') { suggested = 'fravalgt'; why.push('SERP viser en anden sidetype end din side') }
      else if ((a.verdict === 'primaer' || a.verdict === 'sekundaer') && (volume ?? 0) > 0) { suggested = 'kandidat' }
    } else if ((volume ?? 0) > 0) {
      why.push('SERP er ikke analyseret endnu')
    } else {
      why.push('kan beskrive sidens formål, men er ikke automatisk et primært søgeord')
    }
    if (k === input.targetKeyword && input.intentFit === 'mismatch') suggested = 'fravalgt'
    return {
      keyword: k, volume, kd: d ? d.difficulty : null, intents: d ? d.intents : '', context, status, suggested,
      rationale: why.join('. '),
      serp: a ? { verdict: a.verdict, uncertain: a.uncertain, summary: serpSummary(a) } : null,
      onPage: containsKeyword(text, k),
    }
  })

  const approved = candidates.filter(c => c.status === 'godkendt')
  if (approved.length > 0) {
    return { conclusion: 'godkendt', headline: `Godkendt SEO-fokus: ${approved.map(c => `«${c.keyword}»`).join(', ')}`, reason: 'Du har godkendt søgeordet som SEO-mål. Søgeordsrelaterede kontroller er aktive.', candidates }
  }
  if (data.length === 0 && Object.keys(analyses).length === 0) {
    return { conclusion: 'afventer', headline: 'Afventer søgedata', reason: 'Upload en Ahrefs keyword-oversigt og/eller analysér SERP, før der foreslås et primært søgeord. Intet søgeord er valgt.', candidates }
  }
  const suggestable = candidates.filter(c => c.suggested === 'kandidat' && c.status !== 'fravalgt')
  if (suggestable.length > 0) {
    const sum = suggestable.reduce((a, c) => a + (c.volume ?? 0), 0)
    const best = [...suggestable].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0]
    if (suggestable.length >= 3 && (best.volume ?? 0) / Math.max(sum, 1) < 0.5) {
      return { conclusion: 'intet-entydigt', headline: 'Intet entydigt primært søgeord', reason: 'Efterspørgslen er fordelt på flere mindre søgeord med SERP, der passer til siden. Overvej at godkende dem som en gruppe.', candidates }
    }
    return { conclusion: 'primaer', headline: `Forslag til primært søgeord: «${best.keyword}»`, reason: `${best.rationale}. Kræver din godkendelse – status ændres ikke automatisk.`, candidates }
  }
  const withVol = candidates.filter(c => (c.volume ?? 0) > 0 && c.status !== 'fravalgt')
  if (withVol.length === 0) {
    const phrase = input.h1 || input.pageTitle
    return { conclusion: 'sidefokus', headline: `Anbefalet sidefokus: «${phrase}»`, reason: 'Ingen kandidater har registreret volumen. Formuleringen kan beskrive sidens formål, men er ikke automatisk et primært SEO-søgeord. Manglende volumen i Ahrefs betyder ikke, at ingen søger.', candidates }
  }
  return { conclusion: 'afventer', headline: 'Kandidater afventer SERP-verifikation', reason: `${withVol.map(c => `«${c.keyword}» (${c.volume})`).join(', ')} har volumen, men ingen er verificeret mod SERP. Høj volumen alene vælger ikke et primært søgeord – klik "Analysér SERP".`, candidates }
}

// ── Hjælpere til anbefalinger ────────────────────────────────────────────────────────────────
function rec(
  id: string, label: string, verdict: Verdict, status: RecommendationItem['status'], statusLabel: string,
  observation: string, evidence: string, meaning: string, action: string,
): RecommendationItem {
  const detail = `<b>Observation:</b> ${observation}\n<b>Dokumentation:</b> ${evidence}\n<b>Betydning:</b> ${meaning}\n<b>Handling:</b> ${action}`
  return { id, verdict, label, status, statusLabel, detail, observation, evidence, meaning, action }
}

const VERDICT_LABEL: Record<Verdict, string> = { behold: 'Behold', optimer: 'Optimér', manuel: 'Manuel vurdering', 'ikke-verificeret': 'Ikke verificeret' }
const VERDICT_STATUS: Record<Verdict, RecommendationItem['status']> = { behold: 'ok', optimer: 'warn', manuel: 'warn', 'ikke-verificeret': 'neutral' }

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
  const isProduct = pageType === 'produkt'
  const statusMap = input.keywordStatus ?? {}
  const statusOf = (k: string): KwStatus => statusMap[normKw(k)] ?? 'afventer'

  const sentences = plainBody.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  const avgWords = sentences > 0 ? wordCount / sentences : 0
  const readabilityScore: 'Høj' | 'Medium' | 'Lav' = avgWords < 15 ? 'Høj' : avgWords < 22 ? 'Medium' : 'Lav'

  // SERP-analyser pr. søgeord
  const serpAnalyses: Record<string, SerpAnalysis> = {}
  for (const [k, d] of Object.entries(input.serp ?? {})) serpAnalyses[k] = analyzeSerp(d, pageType)

  // ── Godkendt SEO-fokus ──────────────────────────────────────────────────
  const targetApproved = statusOf(input.targetKeyword) === 'godkendt'
  const extrasApproved = input.semanticKeywords.filter(k => statusOf(k) === 'godkendt')
  const kwActive = targetApproved
  const intentFit = input.intentFit || ''

  // ── Målte facts ─────────────────────────────────────────────────────────
  const title = input.pageTitle
  const meta = input.metaDescription
  const titleGoodLength = title.length >= 30 && title.length <= 65
  const metaGoodLength = meta.length >= 120 && meta.length <= 160
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
  const gsc = input.gsc ?? []
  const targetGsc = gsc.filter(r => r.impressions > 0 && countOccurrences(r.keyword, input.targetKeyword) > 0).sort((a, b) => b.impressions - a.impressions)[0]
  const gscGood = !!targetGsc && targetGsc.position <= 5 && targetGsc.clicks / targetGsc.impressions >= 0.8 * expectedCtr(targetGsc.position)
  const gscLine = targetGsc ? ` GSC: «${targetGsc.keyword}» ligger på position ${targetGsc.position.toFixed(1)} med ${targetGsc.impressions.toLocaleString()} visninger og ${targetGsc.clicks.toLocaleString()} klik.` : ''

  const unapprovedNote = !kwActive ? ` Søgeordet «${input.targetKeyword}» er ikke godkendt og indgår derfor ikke i vurderingen.` : ''

  // ══ ANBEFALINGER (én fælles logik; status følger altid verdict) ═══════════════
  const recs: RecommendationItem[] = []

  // Title
  if (!title) {
    recs.push(rec('title', 'Title Tag', 'optimer', 'error', 'Optimér', 'Siden har ingen title.', 'Målt i den scrapede side.', 'Uden title vælger Google selv en titel, og brugeren får intet budskab i søgeresultatet.', 'Skriv en title på 30–65 tegn, der beskriver sidens indhold.'))
  } else if (!titleGoodLength) {
    recs.push(rec('title', 'Title Tag', 'optimer', 'warn', 'Optimér', `Title er ${title.length} tegn (anbefalet 30–65).`, 'Målt tegnantal i den scrapede/redigerede title.', title.length > 65 ? 'Lange titler afkortes i søgeresultatet.' : 'Meget korte titler udnytter ikke pladsen til at beskrive indholdet.', title.length > 65 ? 'Forkort titlen, så vigtigste budskab står først.' : 'Udvid titlen med det, der præcist beskriver siden.'))
  } else if (kwActive && !titleHasKw) {
    recs.push(rec('title', 'Title Tag', 'optimer', 'warn', 'Optimér', `Det godkendte søgeord «${input.targetKeyword}» står ikke i titlen.`, 'Du har godkendt søgeordet; tekstmatch i titlen er målt.', 'Titlen er det tydeligste signal om, hvad siden handler om.', 'Overvej at placere søgeordet (eller en naturlig variant) tidligt i titlen – uden at gøre den unaturlig.'))
  } else if (titleConsistent) {
    recs.push(rec('title', 'Title Tag', 'behold', 'ok', 'Behold', `Titlen er ${title.length} tegn og beskriver sidens emne.`, `Titlens ord (${titleCons.hit} af ${titleCons.total}) genfindes i H1/brødtekst.${gscGood ? gscLine : ''}${unapprovedNote}`, 'Titlen matcher sidens faktiske indhold og har passende længde.', 'Behold titlen. Der er ingen dokumenteret grund til at ændre den.'))
  } else {
    recs.push(rec('title', 'Title Tag', 'manuel', 'warn', 'Manuel vurdering', 'Titlens ord genfindes kun delvist i H1/brødtekst.', `Kun ${titleCons.hit} af ${titleCons.total} betydende ord i titlen findes på siden.${unapprovedNote}`, 'Det kan være bevidst (fx brand/formål), men kan også tyde på, at titel og indhold ikke hænger sammen.', 'Vurdér selv, om titlen afspejler sidens indhold og formål.'))
  }

  // H1
  if (!h1Present) {
    recs.push(rec('h1', 'H1', 'optimer', 'error', 'Optimér', 'Siden har ingen H1.', 'Ingen H1 fundet i det scrapede indhold.', 'H1 giver brugere og søgemaskiner et tydeligt emnesignal.', 'Tilføj én H1, der beskriver sidens emne.'))
  } else if (h1Brand) {
    recs.push(rec('h1', 'H1', 'optimer', 'warn', 'Optimér', `H1 indeholder brandnavn eller separator: «${input.h1}».`, 'Målt i den scrapede H1.', 'H1 bør alene beskrive sidens emne; brand hører til i title.', 'Fjern brandnavn/separator fra H1.'))
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
    recs.push(rec('links', 'Internal Links', 'behold', 'ok', 'Behold', `${internalLinks} link(s) i indholdet.`, 'Talt i det scrapede indhold.', 'Antal links dokumenterer ikke relevans; ét relevant link er bedre end mange irrelevante.', 'Ingen handling udløst.'))
  } else {
    recs.push(rec('links', 'Internal Links', 'manuel', 'warn', 'Manuel vurdering', 'Ingen links i indholdet.', 'Talt i det scrapede indhold.', 'Interne links kan hjælpe brugeren videre, men kun hvis der findes relevante sider.', 'Vurdér selv, om der er relevante sider at linke til.'))
  }

  // Meta
  if (!meta) {
    recs.push(rec('meta', 'Meta Description', 'optimer', 'error', 'Optimér', 'Siden har ingen meta description.', 'Ingen meta description fundet.', 'Google vælger selv et uddrag, som sjældent er optimalt.', 'Skriv en beskrivelse på 120–160 tegn, der forklarer, hvad brugeren finder.'))
  } else if (!metaGoodLength) {
    recs.push(rec('meta', 'Meta Description', 'optimer', 'warn', 'Optimér', `Meta description er ${meta.length} tegn (anbefalet 120–160).`, 'Målt tegnantal.', 'Længden påvirker, om teksten afkortes. Google vælger selv, hvilket snippet der vises, så effekten på CTR kan ikke garanteres.', meta.length > 160 ? 'Forkort beskrivelsen.' : 'Udvid beskrivelsen med en konkret fordel.'))
  } else if (kwActive && !metaHasKw) {
    recs.push(rec('meta', 'Meta Description', 'optimer', 'warn', 'Optimér', `Det godkendte søgeord «${input.targetKeyword}» står ikke i meta description.`, 'Du har godkendt søgeordet; tekstmatch i meta er målt.', 'Fremhævede søgeord kan gøre uddraget mere relevant – men Google kan vælge et andet snippet.', 'Overvej at nævne søgeordet naturligt.'))
  } else if (metaConsistent) {
    recs.push(rec('meta', 'Meta Description', 'behold', 'ok', 'Behold', `Meta description er ${meta.length} tegn og beskriver siden.`, `Beskrivelsens ord (${metaCons.hit} af ${metaCons.total}) genfindes på siden.${gscGood ? gscLine : ''}${unapprovedNote}`, 'Beskrivelsen er relevant og har passende længde. Google vælger selv snippet, så effekt på CTR kan ikke garanteres.', 'Behold meta description.'))
  } else {
    recs.push(rec('meta', 'Meta Description', 'manuel', 'warn', 'Manuel vurdering', 'Meta descriptions ord genfindes kun delvist på siden.', `Kun ${metaCons.hit} af ${metaCons.total} betydende ord findes på siden.${unapprovedNote}`, 'Beskrivelsen lover måske noget andet end siden indeholder.', 'Vurdér selv, om beskrivelsen passer til sidens indhold.'))
  }

  // FAQ (brugerindhold – FAQ rich results er udfaset af Google)
  const hasFaq = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a)/i.test((plainBody + ' ' + input.h1 + ' ' + title).toLowerCase())
  recs.push(rec('faq', 'FAQ Section', 'behold', 'ok', 'Behold', hasFaq ? 'FAQ-sektion fundet.' : 'Ingen FAQ-sektion.', 'Søgt i det scrapede indhold.', 'FAQ er nyttigt for brugerne, hvis kunderne reelt stiller spørgsmålene. Google har udfaset FAQ rich results, så FAQPage JSON-LD er ikke længere et SEO-tiltag.', 'Ingen handling.'))

  // Structured data
  recs.push(sdActive
    ? rec('structured-data', 'Structured Data', 'behold', 'ok', `Aktiv: ${sdTypes.join(', ')}`, `Du har markeret: ${sdTypes.join(', ')}.`, 'Markeret manuelt af dig – værktøjet læser ikke sidens markup.', 'Markup kan give rige visninger, hvis det er gyldigt.', 'Verificér i Rich Results Test: https://search.google.com/test/rich-results')
    : rec('structured-data', 'Structured Data', 'ikke-verificeret', 'neutral', 'Ikke verificeret', 'Sidens markup er ikke undersøgt.', 'Værktøjet læser ikke sidens markup.', 'Der kan hverken konkluderes fejl eller mangler.', 'Tjek i Rich Results Test og markér de typer, siden har.'))

  // Søgeordsfokus
  if (kwActive) {
    if (targetCount === 0) {
      recs.push(rec('focus', 'Godkendt søgeord', 'optimer', 'warn', 'Optimér', `«${input.targetKeyword}» findes ikke på siden.`, 'Godkendt af dig; flexibelt tekstmatch (inkl. bøjning og sammensatte ord).', 'Et godkendt SEO-mål bør være dækket i siden.', 'Dæk søgeordet naturligt i title, H1 eller brødtekst.'))
    } else {
      recs.push(rec('focus', 'Godkendt søgeord', 'behold', 'ok', 'Behold', `«${input.targetKeyword}» findes ${targetCount} gang(e) på siden.`, 'Godkendt af dig; flexibelt tekstmatch.', 'Søgeordet er dækket. Der er ingen fast målværdi for antal forekomster.', 'Ingen handling.'))
    }
  } else {
    recs.push(rec('focus', 'SEO-søgeord', 'ikke-verificeret', 'neutral', 'Ikke verificeret', `Intet SEO-søgeord er godkendt (analyseret: «${input.targetKeyword}»).`, 'Søgeordsstatus er AFVENTER/KANDIDAT/FRAVALGT.', 'Søgeordsrelaterede kontroller er derfor ikke aktive og indgår ikke i scoren.', 'Vurdér kandidaterne under Keywords → Søgeordsfokus (SERP, volumen, forretningsmatch) og godkend ét, når du har verificeret det.'))
  }

  if (intentFit) {
    recs.push(rec('intent', 'Søgeintention / B2B-match', intentFit === 'match' ? 'behold' : 'manuel', intentFit === 'match' ? 'ok' : 'warn', intentFit === 'match' ? 'Behold' : 'Manuel vurdering', `Du har vurderet intention som: ${intentFit === 'match' ? 'match' : intentFit === 'partial' ? 'delvist match' : 'ikke match'}.`, 'Din egen vurdering.', intentFit === 'match' ? 'Forbedringer har størst effekt, når intentionen passer.' : 'Tekstoptimering kan ikke rette et intent-mismatch.', intentFit === 'match' ? 'Ingen handling.' : 'Overvej, om siden er den rigtige til søgningen, før du optimerer den.'))
  }

  // Status følger altid verdict (undtagen "error" ved manglende element, og structured data-label)
  for (const r of recs) {
    if (r.status !== 'error') r.status = VERDICT_STATUS[r.verdict]
    if (r.status !== 'error' && !r.statusLabel.startsWith('Aktiv')) r.statusLabel = VERDICT_LABEL[r.verdict]
  }

  // ══ SCORE (tre adskilte dele) ════════════════════════════════════════════════
  // 1) Automatisk on-page-kontrol: kun målbare, strukturelle forhold. Ingen søgeord, ingen længdebonus.
  const consPts = titleConsistent ? 10 : 0
  const metaConsPts = metaConsistent ? 5 : 0
  const contentPts = wordCount >= (isProduct ? 80 : 150) ? 10 : 0
  const h2Pts = isProduct ? 10 : h2Count >= 2 ? 10 : h2Count >= 1 ? 5 : 0
  const breakdown: ScoreRow[] = [
    { group: 'on-page', label: 'Title til stede', earned: title ? 8 : 0, max: 8, note: title ? 'Fundet' : 'Mangler' },
    { group: 'on-page', label: 'Title: længde 30–65 tegn', earned: titleGoodLength ? 12 : 0, max: 12, note: `${title.length} tegn` },
    { group: 'on-page', label: 'Meta description til stede', earned: meta ? 8 : 0, max: 8, note: meta ? 'Fundet' : 'Mangler' },
    { group: 'on-page', label: 'Meta: længde 120–160 tegn', earned: metaGoodLength ? 12 : 0, max: 12, note: `${meta.length} tegn` },
    { group: 'on-page', label: 'H1 til stede', earned: h1Present ? 15 : 0, max: 15, note: h1Present ? 'Fundet' : 'Mangler' },
    { group: 'on-page', label: 'Underoverskrifter', earned: h2Pts, max: 10, note: isProduct ? 'Produktside – fuld værdi' : `${h2Count} H2` },
    { group: 'on-page', label: 'Indhold til stede', earned: contentPts, max: 10, note: `${wordCount} ord (grundkontrol, ikke kvalitetsmål)` },
    { group: 'on-page', label: 'Interne links til stede', earned: internalLinks >= 1 ? 10 : 0, max: 10, note: `${internalLinks} fundet (grundkontrol)` },
    { group: 'on-page', label: 'Title passer til sidens indhold', earned: consPts, max: 10, note: titleCons.total ? `${titleCons.hit}/${titleCons.total} ord genfundet` : 'Intet at sammenligne' },
    { group: 'on-page', label: 'Meta passer til sidens indhold', earned: metaConsPts, max: 5, note: metaCons.total ? `${metaCons.hit}/${metaCons.total} ord genfundet` : 'Intet at sammenligne' },
    { group: 'on-page', label: 'Struktureret data (bonus)', earned: sdActive ? 5 : 0, max: 5, bonus: true, note: sdActive ? 'Markeret af dig' : 'Ikke verificeret – tæller hverken for eller imod' },
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
  const percentage = Math.min(Math.max(Math.round((onPageRaw / onPageDenom) * 100), 0), 100)
  const relRows = breakdown.filter(r => r.group === 'relevans' && !r.excluded)
  const relDenom = relRows.reduce((a, r) => a + r.max, 0)
  const relevanceScore = kwActive && relDenom > 0 ? Math.round((sum(relRows) / relDenom) * 100) : null
  const scoreFormula = `On-page-kontrol: ${onPageRaw} point af ${onPageDenom} mulige = ${percentage} % (kun automatiske, målbare kontroller)`
  const relevanceFormula = relevanceScore === null ? 'SEO-relevans: ikke beregnet – ingen godkendt søgeord' : `SEO-relevans: ${sum(relRows)} point af ${relDenom} mulige = ${relevanceScore} % (kun for godkendte søgeord)`

  // 3) Potentiale (GSC)
  const potential = computePotential(gsc, text, intentFit, input.gscMeta, input.url)

  // Fokus
  const focus = computeFocus(input, text, serpAnalyses)

  // ── Søgeords-tabel ──────────────────────────────────────────────────────
  const allKeywords = [input.targetKeyword, ...input.semanticKeywords].filter(Boolean)
  const keywordResults: KeywordResult[] = allKeywords.map(kw => {
    const count = countOccurrences(text, kw)
    const st = statusOf(kw)
    const stNote = st === 'godkendt' ? 'Godkendt' : st === 'fravalgt' ? 'Fravalgt – påvirker ikke score' : st === 'kandidat' ? 'Kandidat – påvirker ikke score' : 'Afventer – påvirker ikke score'
    return { keyword: kw, status: count === 0 ? 'Mangler' : 'God', currentCount: count, recommendedMin: 1, recommendedMax: 0, note: `${count === 0 ? 'Ikke fundet' : 'Fundet'} · ${stNote}` }
  })
  const keywordsFound = keywordResults.filter(k => k.status === 'God').length
  const keywordsMissing = keywordResults.filter(k => k.status === 'Mangler').length
  const semanticCovered = input.semanticKeywords.filter(k => statusOf(k) !== 'fravalgt' && countOccurrences(text, k) >= 1).length

  // ── Analysegrundlag ─────────────────────────────────────────────────────
  const targetSerp = serpAnalyses[normKw(input.targetKeyword)]
  const approvedSerp = [input.targetKeyword, ...extrasApproved].some(k => serpAnalyses[normKw(k)] && serpAnalyses[normKw(k)].organicCount >= 5)
  const gscEnough = potential.confidence === 'ok' || potential.confidence === 'lav'
  const gscVerified = gscEnough && !!(input.gscMeta?.url || input.gscMeta?.period)
  const coverageItems: CoverageItem[] = [
    { label: 'Title, meta og H1 målt', done: !!(title || meta || input.h1), note: 'Fra scrape/redigering' },
    { label: 'Indhold renset og talt', done: wordCount > 0, note: `${wordCount} ord` },
    { label: 'Sidetype angivet', done: pageType !== '', note: pageType || 'Ikke angivet' },
    { label: 'Forretningskontekst angivet', done: !!(input.businessContext || '').trim(), note: (input.businessContext || '').trim() ? 'Angivet' : 'Ikke angivet' },
    { label: 'Søgeord godkendt', done: kwActive, note: kwActive ? input.targetKeyword : 'Intet godkendt søgeord' },
    { label: 'Ahrefs søgedata indlæst', done: (input.kwData ?? []).length > 0, note: (input.kwData ?? []).length ? `${(input.kwData ?? []).length} søgeord` : 'Ikke indlæst' },
    { label: 'SERP verificeret', done: approvedSerp || (!!targetSerp && targetSerp.organicCount >= 5), note: targetSerp ? `${targetSerp.organicCount} resultater (${targetSerp.dataDate ? targetSerp.dataDate.slice(0, 10) : 'dato ukendt'})` : 'Ikke analyseret' },
    { label: 'GSC-data tilstrækkelige og tilknyttet URL/periode', done: gscVerified, note: gsc.length === 0 ? 'Ikke indlæst' : gscVerified ? 'Tilstrækkelige' : 'Utilstrækkelige eller URL/periode mangler' },
    { label: 'Structured data undersøgt', done: sdActive, note: sdActive ? 'Markeret af dig' : 'Ikke undersøgt' },
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
  verdict.push(`Delvis analyse: ${coverageDone} af ${coverageItems.length} forhold er undersøgt – scoren er ikke en samlet SEO-vurdering.`)
  void nBeh

  // ── Content gaps ────────────────────────────────────────────────────────
  const missingKeywords = keywordResults.filter(k => k.status === 'Mangler').map(k => k.keyword)
  const gscMissing = gsc.filter(r => r.impressions >= 10 && !containsKeyword(text, r.keyword)).sort((a, b) => b.impressions - a.impressions).map(r => r.keyword)
  const contentGaps: ContentGap[] = [
    (gsc.length > 0 && potential.confidence === 'ingen')
      ? { num: 'Gap 01 · Manglende dækning', tag: '#ff7043', title: `${gsc.length} forespørgsler registreret`, description: 'Utilstrækkelige data til anbefalinger.', color: '#ff7043' }
      : { num: 'Gap 01 · Manglende dækning', tag: '#ff7043', title: (missingKeywords.length + gscMissing.length) > 0 ? `${missingKeywords.length} keywords + ${gscMissing.length} GSC-søgninger ikke fundet` : 'Semantisk dækning', description: (missingKeywords.length + gscMissing.length) > 0 ? `Ikke fundet: ${[...missingKeywords, ...gscMissing].slice(0, 5).join(', ')}. At noget ikke står på siden er ikke i sig selv et problem – vurdér relevans først.` : 'Alle valgte keywords og GSC-søgninger er dækket.', color: '#ff7043' },
    { num: 'Gap 02 · Intention', tag: '#4f7fff', title: targetSerp ? `SERP: ${serpSummary(targetSerp)}` : 'SERP ikke analyseret', description: targetSerp ? targetSerp.reasons.join(' ') : 'Klik "Analysér SERP" under Keywords for at se, hvilke sidetyper der rangerer – eller tjek top 10 manuelt.', color: '#4f7fff' },
    { num: 'Gap 03 · Strukturerede data', tag: '#2dce89', title: sdActive ? 'Structured data markeret' : 'Structured data ikke undersøgt', description: sdActive ? 'Verificér i Rich Results Test, at markup er til stede og gyldigt.' : 'Værktøjet kan ikke se sidens markup. Tjek i Rich Results Test, før du konkluderer, at noget mangler.', color: '#2dce89' },
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

  return {
    score: onPageRaw,
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
    relevanceFormula,
    coverage: { items: coverageItems, done: coverageDone, total: coverageItems.length },
    serpAnalyses,
    focus,
  }
}
