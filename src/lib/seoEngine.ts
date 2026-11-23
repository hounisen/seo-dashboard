// lib/seoEngine.ts
// Rule-based SEO scoring engine – no AI required, runs entirely client-side

export interface SeoInput {
  url: string
  competitorUrls: string[]
  targetKeyword: string
  semanticKeywords: string[]
  pageTitle: string
  metaDescription: string
  h1: string
  bodyContent: string
  // Auto-populated from scrape
  wordCount?: number
  internalLinks?: number
  h2Count?: number
  hasStructuredData?: boolean
  structuredDataTypes?: string[]
  readabilityScore?: 'Høj' | 'Medium' | 'Lav'
  // Valgfrit: GSC-data og manuel intent-vurdering (bruges til SEO-potentiale)
  gsc?: GscRow[]
  intentFit?: '' | 'match' | 'partial' | 'mismatch'
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

export interface RecommendationItem {
  id: string
  verdict: 'behold' | 'optimer' | 'manuel' | 'ikke-verificeret'
  label: string
  status: 'ok' | 'warn' | 'error' | 'neutral'
  statusLabel: string
  detail: string
}

export interface ScoreRow {
  label: string
  earned: number
  max: number
  note: string
  excluded?: boolean
  bonus?: boolean
}

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
  percentage: number
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
  // To adskilte scorer: percentage = On-page kvalitet (uændret felt for bagudkompatibilitet)
  onPageScore: number
  potentialScore: number | null
  potentialNotes: string[]
  potentialConfidence: 'ingen' | 'lav' | 'ok'
  gscStats: { queries: number; impressions: number }
  verdict: string[]
  scoreBreakdown: ScoreRow[]
  scoreFormula: string
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

function computePotential(
  gsc: GscRow[],
  text: string,
  intentFit: SeoInput['intentFit'],
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
  const confidence: 'lav' | 'ok' = totalImp < 500 ? 'lav' : 'ok'
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
  notes.push(`Datagrundlag: ${rows.length} søgninger, ${totalImp.toLocaleString()} visninger. Perioden fremgår ikke af filen – tjek eksporten i GSC.`)
  if (confidence === 'lav') notes.push('Tallet er usikkert: få visninger i alt.')
  notes.push('Kun søgninger med relevans for sidens formål og målgruppe bør tælle som muligheder – vurdér dem selv.')
  if (intentFit === 'partial') notes.push('Intent delvist match: potentialet er nedvægtet (×0,7).')
  if (intentFit === 'mismatch') notes.push('Intent matcher ikke B2B-målgruppen: potentialet er kraftigt nedvægtet (×0,3).')
  return { score: Math.round(Math.min(raw, 100)), notes, confidence, queries: rows.length, impressions: totalImp }
}

export function analyzeSeo(input: SeoInput): SeoResult {
  const plainBody = toPlainText(input.bodyContent)
  const text = fullText(input)
  const allKeywords = [input.targetKeyword, ...input.semanticKeywords].filter(Boolean)
  const wordCount = input.wordCount ?? plainBody.split(/\s+/).filter(Boolean).length

  // Readability
  const sentences = plainBody.split(/[.!?]+/).filter(s => s.trim().length > 0).length
  const avgWordsPerSentence = sentences > 0 ? wordCount / sentences : 0
  const readabilityScore: 'Høj' | 'Medium' | 'Lav' =
    avgWordsPerSentence < 15 ? 'Høj' : avgWordsPerSentence < 22 ? 'Medium' : 'Lav'

  // GSC-data for target keyword (bruges til "behold uændret"-vurderinger)
  const gsc = input.gsc ?? []
  const targetGsc = gsc
    .filter(r => r.impressions > 0 && countOccurrences(r.keyword, input.targetKeyword) > 0)
    .sort((a, b) => b.impressions - a.impressions)[0]
  const targetRanksWell = !!targetGsc && targetGsc.position <= 5
  const targetCtrOk = !!targetGsc && targetGsc.clicks / targetGsc.impressions >= 0.8 * expectedCtr(targetGsc.position)

  // ── ON-PAGE KVALITET (100 point) ─────────────────────────────────────────
  const intentDoubt = input.intentFit === 'partial' || input.intentFit === 'mismatch'
  const sdActiveEarly = !!(input.structuredDataTypes && input.structuredDataTypes.length > 0)
  let score = 0
  let kwEarned = 0 // point der afhænger af target keyword (title 10, meta 8, H1 5, tekst 15 = 38)

  // 1. Title tag (15)
  const titleHasKeyword = containsKeyword(input.pageTitle, input.targetKeyword)
  const titleGoodLength = input.pageTitle.length >= 30 && input.pageTitle.length <= 65
  if (titleHasKeyword) { score += 10; kwEarned += 10 }
  if (titleGoodLength) score += 5

  // 2. Meta description (15)
  const metaHasKeyword = containsKeyword(input.metaDescription, input.targetKeyword)
  const metaGoodLength = input.metaDescription.length >= 120 && input.metaDescription.length <= 160
  if (metaHasKeyword) { score += 8; kwEarned += 8 }
  if (metaGoodLength) score += 7

  // 3. H1 (10)
  const h1HasKeyword = containsKeyword(input.h1, input.targetKeyword)
  const h1Present = input.h1.length > 0
  if (h1Present) score += 5
  if (h1HasKeyword) { score += 5; kwEarned += 5 }

  // 4. Indholdsmængde (20) – målt på renset tekst (uden links/URL'er/produkt-UI)
  if (wordCount >= 800) score += 20
  else if (wordCount >= 500) score += 14
  else if (wordCount >= 300) score += 8
  else if (wordCount >= 150) score += 4

  // 5. Target keyword i teksten (15) – ingen fast densitet; flere naturlige forekomster er bedre op til et fornuftigt niveau
  const targetCount = countOccurrences(text, input.targetKeyword)
  const density = wordCount > 0 ? (targetCount / wordCount) * 100 : 0
  const overOptimised = density > 3
  let densPts = 0
  if (targetCount >= 3) densPts = 15
  else if (targetCount === 2) densPts = 11
  else if (targetCount === 1) densPts = 6
  score += densPts; kwEarned += densPts
  if (overOptimised) score -= 5

  // 6. Semantisk dækning (15)
  const semanticCovered = input.semanticKeywords.filter(kw => countOccurrences(text, kw) >= 1).length
  const semanticTotal = input.semanticKeywords.length || 1
  score += Math.round((semanticCovered / semanticTotal) * 15)

  // 7. Underoverskrifter (5)
  const h2Count = input.h2Count ?? (input.bodyContent.match(/^##\s|<h2/gim) || []).length
  if (h2Count >= 2) score += 5
  else if (h2Count >= 1) score += 3

  // 8. Interne links (5)
  let internalLinks = input.internalLinks ?? 0
  if (internalLinks === 0) {
    const markdownLinks = (input.bodyContent.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length
    const htmlLinks = (input.bodyContent.match(/<a[^>]+href/gi) || []).length
    internalLinks = markdownLinks + htmlLinks
  }
  if (internalLinks >= 1) score += 5

  // 9. Struktureret data (+5, når bekræftet)
  if (input.structuredDataTypes && input.structuredDataTypes.length > 0) score += 5

  // ── FORKLARBAR SCORE ─────────────────────────────────────────────────────
  // Keyword-afhængige point (38) udelades, når intentionen ikke (fuldt) matcher: relevans afgør, ikke fraværet.
  const contentPts = wordCount >= 800 ? 20 : wordCount >= 500 ? 14 : wordCount >= 300 ? 8 : wordCount >= 150 ? 4 : 0
  const h2Pts = h2Count >= 2 ? 5 : h2Count >= 1 ? 3 : 0
  const semPts = Math.round((semanticCovered / semanticTotal) * 15)
  const ex = intentDoubt
  const scoreBreakdown: ScoreRow[] = [
    { label: 'Title: indeholder keyword', earned: titleHasKeyword ? 10 : 0, max: 10, excluded: ex, note: ex ? 'Udeladt – intent matcher ikke fuldt' : titleHasKeyword ? 'Keyword fundet' : 'Keyword ikke fundet' },
    { label: 'Title: længde 30–65 tegn', earned: titleGoodLength ? 5 : 0, max: 5, note: `${input.pageTitle.length} tegn` },
    { label: 'Meta: indeholder keyword', earned: metaHasKeyword ? 8 : 0, max: 8, excluded: ex, note: ex ? 'Udeladt – intent matcher ikke fuldt' : metaHasKeyword ? 'Keyword fundet' : 'Keyword ikke fundet' },
    { label: 'Meta: længde 120–160 tegn', earned: metaGoodLength ? 7 : 0, max: 7, note: `${input.metaDescription.length} tegn` },
    { label: 'H1 til stede', earned: h1Present ? 5 : 0, max: 5, note: h1Present ? 'H1 fundet' : 'Ingen H1' },
    { label: 'H1: indeholder keyword', earned: h1HasKeyword ? 5 : 0, max: 5, excluded: ex, note: ex ? 'Udeladt – intent matcher ikke fuldt' : h1HasKeyword ? 'Keyword fundet' : 'Keyword ikke fundet' },
    { label: 'Indholdsmængde (renset tekst)', earned: contentPts, max: 20, note: `${wordCount} ord` },
    { label: 'Keyword i teksten', earned: densPts, max: 15, excluded: ex, note: ex ? 'Udeladt – intent matcher ikke fuldt' : `${targetCount} forekomst(er)` },
    { label: 'Semantiske keywords dækket', earned: semPts, max: 15, note: input.semanticKeywords.length === 0 ? 'Ingen angivet (0 point)' : `${semanticCovered} af ${input.semanticKeywords.length}` },
    { label: 'Underoverskrifter (H2)', earned: h2Pts, max: 5, note: `${h2Count} fundet` },
    { label: 'Interne links', earned: internalLinks >= 1 ? 5 : 0, max: 5, note: `${internalLinks} fundet` },
    { label: 'Struktureret data (bonus)', earned: sdActiveEarly ? 5 : 0, max: 5, bonus: true, note: sdActiveEarly ? 'Markeret af dig' : 'Ikke verificeret – tæller hverken for eller imod' },
  ]
  if (overOptimised) scoreBreakdown.push({ label: 'Keyword overbrugt (>3 % af ordene)', earned: ex ? 0 : -5, max: 0, excluded: ex, note: ex ? 'Udeladt' : 'Fradrag' })
  const counted = scoreBreakdown.filter(r => !r.excluded)
  const raw = counted.reduce((a, r) => a + r.earned, 0)
  const denom = counted.filter(r => !r.bonus).reduce((a, r) => a + r.max, 0)
  score = Math.max(0, raw)
  const percentage = Math.min(Math.max(Math.round((raw / denom) * 100), 0), 100)
  const scoreFormula = `${raw} point af ${denom} mulige = ${percentage} %` + (ex ? ' (keyword-afhængige point udeladt)' : '')

  // ── SEO-POTENTIALE (kræver GSC) ───────────────────────────────────────────
  const potential = computePotential(gsc, text, input.intentFit)

  // ── KEYWORD TABLE (uden fast densitetsmål) ───────────────────────────────
  const keywordResults: KeywordResult[] = allKeywords.map(kw => {
    const count = countOccurrences(text, kw)
    const isTarget = kw === input.targetKeyword
    const inKeyPlace = isTarget && (titleHasKeyword || h1HasKeyword)

    let status: KeywordStatus
    let note: string
    if (count === 0) { status = 'Mangler'; note = intentDoubt && isTarget ? 'Ikke fundet – indgår ikke i scoren (intent ikke match)' : 'Ikke fundet – tilføj hvis det passer til intentionen' }
    else if (isTarget && count === 1 && !inKeyPlace) { status = 'Optimer'; note = 'Kun nævnt én gang og ikke i title/H1' }
    else if (!isTarget && count === 0) { status = 'Mangler'; note = 'Ikke fundet' }
    else { status = 'God'; note = isTarget && overOptimised ? 'Nævnt meget ofte – tjek at det læses naturligt' : 'Dækket – ingen fast målværdi' }

    return { keyword: kw, status, currentCount: count, recommendedMin: 1, recommendedMax: 0, note }
  })

  const keywordsFound = keywordResults.filter(k => k.status === 'God').length
  const keywordsOptimise = keywordResults.filter(k => k.status === 'Optimer').length
  const keywordsMissing = keywordResults.filter(k => k.status === 'Mangler').length

  // ── ANBEFALINGER MED BEGRUNDELSE ──────────────────────────────────────────
  const why = (t: string) => `\n<b>Hvorfor:</b> ${t}`
  const gscLine = targetGsc
    ? `GSC: "${targetGsc.keyword}" ligger på position ${targetGsc.position.toFixed(1)} med ${targetGsc.impressions.toLocaleString()} visninger og ${targetGsc.clicks.toLocaleString()} klik.`
    : ''

  const faqRegex = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a|questions)/i
  const cleanAll = (plainBody + ' ' + input.h1 + ' ' + input.pageTitle).toLowerCase()
  const hasFaq = faqRegex.test(cleanAll)
  const sdActive = !!(input.structuredDataTypes && input.structuredDataTypes.length > 0)

  // Title
  const keepTitle = (titleHasKeyword && titleGoodLength && targetRanksWell && targetCtrOk) || (intentDoubt && titleGoodLength)
  const recTitle: RecommendationItem = {
    id: 'title',
    verdict: keepTitle ? 'behold' : !titleHasKeyword ? (input.intentFit === 'match' ? 'optimer' : 'manuel') : titleGoodLength ? 'behold' : 'optimer',
    label: 'Title Tag',
    status: keepTitle || (titleHasKeyword && titleGoodLength) ? 'ok' : titleHasKeyword ? 'warn' : 'error',
    statusLabel: keepTitle ? 'Behold uændret' : titleHasKeyword && titleGoodLength ? 'Optimised' : titleHasKeyword ? '1 advarsel' : '1 fejl',
    detail: keepTitle && intentDoubt && !titleHasKeyword
      ? `Behold nuværende title (${input.pageTitle.length} tegn) – og overvej først, om "${input.targetKeyword}" overhovedet bør være sidens primære søgeord.` + why('Du har vurderet, at intentionen ikke (fuldt) matcher målgruppen. En title, der passer til sortiment og målgruppe, er vigtigere end at få et bestemt keyword med.')
      : keepTitle
      ? `Behold title uændret (${input.pageTitle.length} tegn).` + why(intentDoubt ? 'Du har vurderet, at intentionen kun delvist matcher – så er en præcis title bedre end at presse keywordet ind.' : `Den indeholder keywordet, har god længde, og siden rangerer allerede godt med fornuftig CTR. ${gscLine} En ændring risikerer at flytte placeringen.`)
      : titleHasKeyword
        ? titleGoodLength
          ? `Title tag er god (${input.pageTitle.length} tegn) og indeholder target keyword.` + why(`Title er det stærkeste on-page signal for keywordet.${gscLine ? ' ' + gscLine : ''}`)
          : `Title indeholder keyword, men er ${input.pageTitle.length} tegn. Optimal længde: 30–65 tegn.` + why('Længere titler afkortes i søgeresultatet og mister budskab.')
        : `Title mangler target keyword "${input.targetKeyword}". Vurdér først, om det bør være sidens primære søgeord (se Søgeintention) – tilføj det kun, hvis det matcher sortiment og målgruppe.` + why('Google og brugeren bruger titlen til at afgøre om siden matcher søgningen – men et forkert primært søgeord er værre end et manglende.'),
  }

  // H1
  const recH1: RecommendationItem = {
    id: 'h1',
    verdict: !h1Present ? 'optimer' : /\s\|\s|®/.test(input.h1) ? 'optimer' : h1HasKeyword ? 'behold' : (input.intentFit === 'match' ? 'optimer' : 'manuel'),
    label: 'H1',
    status: h1HasKeyword ? 'ok' : h1Present ? 'warn' : 'error',
    statusLabel: h1HasKeyword ? 'Optimised' : h1Present ? '1 advarsel' : '1 fejl',
    detail: h1HasKeyword
      ? `H1 indeholder "${input.targetKeyword}".` + why('H1 bekræfter sidens emne for både brugere og søgemaskiner. Behold den, hvis den også læser godt for mennesker.')
      : h1Present
        ? `H1 mangler target keyword. Nuværende H1: "${input.h1}"` + why('H1 bør afspejle den søgning, siden skal ramme – dog kun hvis det ikke gør den unaturlig.')
        : `Ingen H1 fundet. Tilføj en H1 med target keyword.` + why('Uden H1 mangler siden et tydeligt emnesignal.'),
  }

  // Subheadings
  const recH2: RecommendationItem = {
    id: 'subheadings',
    verdict: h2Count >= 2 ? 'behold' : 'optimer',
    label: 'Subheadings',
    status: h2Count >= 2 ? 'ok' : h2Count >= 1 ? 'warn' : 'error',
    statusLabel: h2Count >= 2 ? 'Optimised' : `${h2Count} fundet`,
    detail: h2Count >= 2
      ? `${h2Count} H2-overskrifter fundet. God struktur.` + why('Underoverskrifter gør siden skimbar og giver plads til beslægtede søgninger.')
      : `Kun ${h2Count} H2 fundet. Brug underoverskrifter til de emner, brugeren forventer at finde.` + why('Struktur hjælper både læsere og søgemaskiner med at finde svaret.'),
  }

  // Content
  const recContent: RecommendationItem = {
    id: 'content',
    verdict: wordCount >= 500 ? 'behold' : wordCount >= 300 ? 'manuel' : 'optimer',
    label: 'Content Length',
    status: wordCount >= 500 ? 'ok' : wordCount >= 300 ? 'warn' : 'error',
    statusLabel: wordCount >= 500 ? 'Optimised' : wordCount >= 300 ? '1 advarsel' : '1 fejl',
    detail: `Siden har ~${wordCount} ord reelt indhold (efter fjernelse af links, produktkort, kontaktlinjer og lignende). ` +
      (wordCount >= 500
        ? 'Længden er ikke i sig selv et problem – tilføj kun noget, hvis der mangler emner brugeren leder efter.'
        : 'Teksten er tynd. Tilføj kun indhold, der besvarer brugerens spørgsmål eller dækker manglende søgninger – ikke fyld for længdens skyld.') +
      why('Ordantal er ikke en rangeringsfaktor i sig selv; det er dækningen af intentionen, der tæller.'),
  }

  // Links
  const recLinks: RecommendationItem = {
    id: 'links',
    verdict: internalLinks >= 1 ? 'behold' : 'optimer',
    label: 'Internal Links',
    status: internalLinks >= 1 ? 'ok' : 'error',
    statusLabel: internalLinks >= 1 ? 'Optimised' : '0 fundet',
    detail: internalLinks >= 1
      ? `${internalLinks} ${internalLinks === 1 ? 'link' : 'links'} i indholdet.` + why('Ét relevant link er bedre end mange irrelevante.')
      : `Ingen links i indholdet. Tilføj mindst ét relevant link til en beslægtet side.` + why('Interne links viser sammenhæng og fordeler autoritet.'),
  }

  // Meta
  const keepMeta = (metaHasKeyword && metaGoodLength && targetRanksWell && targetCtrOk) || (intentDoubt && metaGoodLength)
  const recMeta: RecommendationItem = {
    id: 'meta',
    verdict: keepMeta ? 'behold' : (metaHasKeyword && metaGoodLength) ? 'behold' : (!metaGoodLength ? 'optimer' : (input.intentFit === 'match' ? 'optimer' : 'manuel')),
    label: 'Meta Description',
    status: keepMeta || (metaHasKeyword && metaGoodLength) ? 'ok' : 'warn',
    statusLabel: keepMeta ? 'Behold uændret' : metaHasKeyword && metaGoodLength ? 'Optimised' : '1 advarsel',
    detail: keepMeta
      ? `Behold meta description uændret (${input.metaDescription.length} tegn).` + why(intentDoubt && !(targetRanksWell && targetCtrOk) ? 'Længden passer, og du har vurderet, at intentionen kun delvist matcher – så er en præcis beskrivelse bedre end at presse keywordet ind.' : `Keyword er med, længden passer, og CTR er rimelig for placeringen. ${gscLine}`)
      : metaHasKeyword
        ? metaGoodLength
          ? `Meta description er god (${input.metaDescription.length} tegn).` + why('Meta påvirker ikke placeringen direkte. Google vælger selv, hvilket snippet der vises, så en CTR-effekt kan ikke garanteres.')
          : `Meta indeholder keyword, men er ${input.metaDescription.length} tegn. Optimal: 120–160 tegn.` + why('For lange beskrivelser afkortes.')
        : `Meta mangler target keyword og/eller har uheldig længde (${input.metaDescription.length} tegn). Optimal: 120–160 tegn.` + why('Et relevant snippet kan hjælpe CTR, men Google kan vælge en anden tekst, så effekten kan ikke garanteres.'),
  }

  // FAQ (indhold til brugeren – ikke længere SEO-tiltag via FAQPage rich results)
  const recFaq: RecommendationItem = {
    id: 'faq',
    verdict: 'behold',
    label: 'FAQ Section',
    status: 'ok',
    statusLabel: hasFaq ? 'Fundet' : 'Valgfri',
    detail: hasFaq
      ? 'FAQ-sektion fundet. Den hjælper brugerne – men Google har udfaset FAQ rich results, så FAQPage JSON-LD giver ikke længere udvidede resultater.'
      : 'Ingen FAQ-sektion. Tilføj kun, hvis kunderne reelt stiller spørgsmålene – som hjælp til brugeren, ikke for rich results.' + why('Google har udfaset FAQ rich results, så FAQPage JSON-LD er ikke længere et SEO-tiltag.'),
  }

  // Structured data (værktøjet undersøger ikke sidens markup – kun din markering)
  const recSd: RecommendationItem = {
    id: 'structured-data',
    verdict: sdActive ? 'behold' : 'ikke-verificeret',
    label: 'Structured Data',
    status: sdActive ? 'ok' : 'warn',
    statusLabel: sdActive ? `Aktiv: ${input.structuredDataTypes!.join(', ')}` : 'Ikke undersøgt',
    detail: sdActive
      ? `✓ Du har markeret: ${input.structuredDataTypes!.join(', ')}. Test markup her: https://search.google.com/test/rich-results`
      : `Værktøjet læser ikke sidens markup, så det kan ikke se, om structured data mangler. Tjek i Rich Results Test (https://search.google.com/test/rich-results) og markér de typer, siden har.`,
  }

  const recommendations: RecommendationItem[] = [recTitle, recH1, recH2, recContent, recLinks, recMeta, recFaq, recSd]

  if (input.intentFit) {
    recommendations.push({
      id: 'intent',
      verdict: input.intentFit === 'match' ? 'behold' : 'manuel',
      label: 'Søgeintention / B2B-match',
      status: input.intentFit === 'match' ? 'ok' : input.intentFit === 'partial' ? 'warn' : 'error',
      statusLabel: input.intentFit === 'match' ? 'Match' : input.intentFit === 'partial' ? 'Delvist' : 'Ikke match',
      detail: input.intentFit === 'match'
        ? 'Du har vurderet, at søgeintentionen passer til målgruppen.' + why('Når intentionen passer, giver forbedringer størst effekt.')
        : 'Du har vurderet, at intentionen kun delvist/ikke matcher målgruppen.' + why('Tekstoptimering kan ikke rette et intent-mismatch – overvej om siden er den rigtige til søgningen, før du bruger tid på den.'),
    })
  }

  // H1 med brandnavn/separator
  if (h1Present && /\s\|\s|®/.test(input.h1)) {
    recH1.detail += '\n<b>Bemærk:</b> H1 indeholder brandnavn eller separator. Overvej at lade H1 alene beskrive sidens emne.'
  }

  // Status og anbefaling må ikke modsige hinanden: den faglige beslutning (verdict) er primær.
  const absent: Record<string, boolean> = {
    title: !input.pageTitle, h1: !h1Present, links: internalLinks < 1,
    meta: !input.metaDescription, subheadings: h2Count < 1, content: wordCount < 150,
  }
  const verdictLabel = { behold: 'Behold', optimer: 'Optimér', manuel: 'Manuel vurdering', 'ikke-verificeret': 'Ikke verificeret' } as const
  for (const rec of recommendations) {
    const v = rec.verdict
    rec.status = v === 'behold' ? 'ok' : v === 'ikke-verificeret' ? 'neutral' : v === 'manuel' ? 'warn' : (absent[rec.id] ? 'error' : 'warn')
    if (!(rec.id === 'structured-data' && sdActive) && rec.statusLabel !== 'Behold uændret') rec.statusLabel = verdictLabel[v]
  }

  // ── CONTENT GAPS ─────────────────────────────────────────────────────────
  const missingKeywords = keywordResults.filter(k => k.status === 'Mangler').map(k => k.keyword)
  const gscMissing = gsc
    .filter(r => r.impressions > 0 && !containsKeyword(text, r.keyword))
    .sort((a, b) => b.impressions - a.impressions)
    .map(r => r.keyword)

  const contentGaps: ContentGap[] = [
    (gsc.length > 0 && potential.confidence === 'ingen')
      ? {
          num: 'Gap 01 · Manglende dækning',
          tag: '#ff7043',
          title: `${gsc.length} forespørgsler registreret`,
          description: `Utilstrækkelige data til anbefalinger.${missingKeywords.length > 0 ? ` Valgte keywords, der ikke er fundet: ${missingKeywords.slice(0, 4).join(', ')} – tilføj kun, hvis det passer til sidens formål.` : ''}`,
          color: '#ff7043',
        }
      : {
          num: 'Gap 01 · Manglende dækning',
          tag: '#ff7043',
          title: (missingKeywords.length + gscMissing.length) > 0 ? `${missingKeywords.length} keywords + ${gscMissing.length} GSC-søgninger ikke fundet` : 'Semantisk dækning',
          description: (missingKeywords.length + gscMissing.length) > 0
            ? `Ikke fundet på siden: ${[...missingKeywords, ...gscMissing].slice(0, 5).join(', ')}${(missingKeywords.length + gscMissing.length) > 5 ? ' m.fl.' : ''}. At noget ikke står på siden er ikke i sig selv et problem – vurdér relevans først.`
            : 'Alle valgte keywords og GSC-søgninger er dækket.',
          color: '#ff7043',
        },
    {
      num: 'Gap 02 · Intention',
      tag: '#4f7fff',
      title: 'Matcher siden det brugeren leder efter?',
      description: input.intentFit === 'mismatch' || input.intentFit === 'partial'
        ? 'Du har markeret intentionen som delvist/ikke matchende. Afklar det først – ellers risikerer du at optimere en side til forkert målgruppe.'
        : 'Tjek de øverste resultater for søgningen: er det kategorisider, guides eller B2C-butikker? Siden skal ligne dem, der rangerer.',
      color: '#4f7fff',
    },
    {
      num: 'Gap 03 · Strukturerede data',
      tag: '#2dce89',
      title: sdActive ? 'Structured data markeret' : 'Structured data ikke undersøgt',
      description: sdActive
        ? 'Du har markeret schema-typer. Verificér i Rich Results Test, at markup faktisk er til stede og gyldigt.'
        : 'Værktøjet kan ikke se sidens markup. Tjek i Rich Results Test, før du konkluderer, at noget mangler.',
      color: '#2dce89',
    },
  ]

  // ── QUICK WINS ────────────────────────────────────────────────────────────
  const quickWins: SeoResult['quickWins'] = []

  const metaVerdictOptimer = recMeta.verdict === 'optimer'
  const metaManual = recMeta.verdict === 'manuel'
  if (metaManual) {
    quickWins.push({
      priority: 'yellow',
      title: 'Meta description: manuel vurdering',
      detail: 'Keywordet mangler, men længden er fin. Vurdér først søgeintention og sortimentsmatch – ændr kun, hvis det understøtter sidens formål.',
    })
  }
  if (metaVerdictOptimer) {
    quickWins.push({
      priority: 'red',
      title: 'Opdatér meta description',
      detail: !metaGoodLength ? `Meta er ${input.metaDescription.length} tegn – hold 120–160 tegn. Google vælger selv snippet, så CTR-effekt kan ikke garanteres.` : `Medtag "${input.targetKeyword}". Google vælger selv snippet, så CTR-effekt kan ikke garanteres.`,
    })
  }
  if (!titleHasKeyword) {
    quickWins.push({
      priority: input.intentFit === 'match' ? 'red' : 'yellow',
      title: input.intentFit === 'match' ? 'Få keywordet ind i title' : 'Afklar om keywordet bør være primært',
      detail: input.intentFit === 'match'
        ? `Title mangler "${input.targetKeyword}" – det er det stærkeste on-page signal.`
        : `Title mangler "${input.targetKeyword}". Vurdér først søgeintention og sortimentsmatch (feltet i venstre side) – en præcis title er bedre end et forkert primært søgeord.`,
    })
  }
  const gscStrong = gsc
    .filter(r => r.impressions >= 10 && !containsKeyword(text, r.keyword))
    .sort((a, b) => b.impressions - a.impressions)
    .map(r => r.keyword)
  if (potential.confidence !== 'ingen' && gscStrong.length > 0) {
    quickWins.push({
      priority: 'yellow',
      title: 'Vurdér søgninger fra GSC, der ikke står på siden',
      detail: `${gscStrong.slice(0, 3).join(', ')} har mindst 10 visninger. At de ikke står på siden er ikke i sig selv et problem – tilføj kun dem, der passer til sortiment, målgruppe og sidens formål.`,
    })
  } else if (gsc.length > 0 && potential.confidence === 'ingen') {
    quickWins.push({
      priority: 'green',
      title: 'GSC-data er utilstrækkelige',
      detail: 'For få visninger til at udpege nye muligheder. Brug en længere periode eller flere søgninger, før du handler på dem.',
    })
  } else if (missingKeywords.length > 0) {
    quickWins.push({
      priority: 'yellow',
      title: 'Dæk manglende semantiske keywords',
      detail: `${missingKeywords.slice(0, 3).join(', ')} – brug dem naturligt i brødtekst, overskrifter eller FAQ.`,
    })
  }
  if (keepTitle || keepMeta) {
    quickWins.push({
      priority: 'green',
      title: `Behold ${keepTitle && keepMeta ? 'title og meta' : keepTitle ? 'title' : 'meta'} uændret`,
      detail: 'Siden rangerer allerede godt for target keyword – lad det, der virker, være i fred, og fokusér på indholdet.',
    })
  }
  if (wordCount < 300) {
    quickWins.push({
      priority: 'yellow',
      title: 'Udbyg det reelle indhold',
      detail: `Kun ~${wordCount} ord reelt indhold. Tilføj afsnit, der besvarer brugerens spørgsmål.`,
    })
  }
  if (internalLinks < 3) {
    quickWins.push({
      priority: 'green',
      title: 'Styrk interne links',
      detail: 'Link fra relaterede sider med naturlige ankertekster.',
    })
  }

  // ── SAMLET VURDERING ─────────────────────────────────────────────────────
  const verdict: string[] = []
  if (keepTitle && keepMeta) verdict.push('Behold den eksisterende title og meta description.')
  else if (keepTitle) verdict.push('Behold den eksisterende title.')
  else if (keepMeta) verdict.push('Behold den eksisterende meta description.')
  const covered = keywordResults.filter(k => k.status === 'God').map(k => k.keyword)
  if (covered.length > 0) verdict.push(`Allerede dækket: ${covered.slice(0, 4).join(', ')}.`)
  if (missingKeywords.length > 0) verdict.push(`Ikke fundet på siden: ${missingKeywords.slice(0, 4).join(', ')} – tilføj kun, hvis det passer til sidens formål.`)
  if (gsc.length > 0 && potential.confidence === 'ingen') verdict.push('GSC-data er utilstrækkelige til at pege på nye muligheder.')
  if (!input.intentFit) verdict.push('Vurdér søgeintention og B2B-match, før du ændrer title, H1 eller brødtekst.')
  if (verdict.length === 0) verdict.push('Ingen tydelige handlinger – siden ser ud til at passe til sit formål.')

  return {
    score,
    maxScore: 100,
    percentage,
    keywords: keywordResults,
    recommendations,
    contentGaps,
    quickWins,
    wordCount,
    keywordsFound,
    keywordsMissing,
    keywordsOptimise,
    readabilityScore,
    targetKeywordCount: targetCount,
    semanticKeywordsCovered: semanticCovered,
    semanticKeywordsTotal: input.semanticKeywords.length,
    onPageScore: percentage,
    potentialScore: potential.score,
    potentialNotes: potential.notes,
    potentialConfidence: potential.confidence,
    gscStats: { queries: potential.queries, impressions: potential.impressions },
    verdict,
    scoreBreakdown,
    scoreFormula,
  }
}
