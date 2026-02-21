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
}

export type KeywordStatus = 'God' | 'Optimer' | 'Mangler'

export interface KeywordResult {
  keyword: string
  status: KeywordStatus
  currentCount: number
  recommendedMin: number
  recommendedMax: number
}

export interface RecommendationItem {
  id: string
  label: string
  status: 'ok' | 'warn' | 'error'
  statusLabel: string
  detail: string
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
}

// Count keyword occurrences in text (case-insensitive)
function countOccurrences(text: string, keyword: string): number {
  if (!text || !keyword) return 0
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = text.toLowerCase().match(new RegExp(escaped.toLowerCase(), 'g'))
  return matches ? matches.length : 0
}

// Merge all text for scanning
function fullText(input: SeoInput): string {
  return [
    input.pageTitle,
    input.metaDescription,
    input.h1,
    input.bodyContent,
  ].join(' ').toLowerCase()
}

export function analyzeSeo(input: SeoInput): SeoResult {
  const text = fullText(input)
  const allKeywords = [input.targetKeyword, ...input.semanticKeywords].filter(Boolean)
  const wordCount = input.wordCount ?? input.bodyContent.split(/\s+/).filter(Boolean).length

  // ── SCORE COMPONENTS (total 100 points) ──────────────────────────────────
  let score = 0

  // 1. Title tag (15 pts)
  const titleHasKeyword = input.pageTitle.toLowerCase().includes(input.targetKeyword.toLowerCase())
  const titleGoodLength = input.pageTitle.length >= 30 && input.pageTitle.length <= 65
  if (titleHasKeyword) score += 10
  if (titleGoodLength) score += 5

  // 2. Meta description (15 pts)
  const metaHasKeyword = input.metaDescription.toLowerCase().includes(input.targetKeyword.toLowerCase())
  const metaGoodLength = input.metaDescription.length >= 120 && input.metaDescription.length <= 160
  if (metaHasKeyword) score += 8
  if (metaGoodLength) score += 7

  // 3. H1 (10 pts)
  const h1HasKeyword = input.h1.toLowerCase().includes(input.targetKeyword.toLowerCase())
  const h1Present = input.h1.length > 0
  if (h1Present) score += 5
  if (h1HasKeyword) score += 5

  // 4. Content length (20 pts)
  if (wordCount >= 800) score += 20
  else if (wordCount >= 500) score += 14
  else if (wordCount >= 300) score += 8
  else if (wordCount >= 150) score += 4

  // 5. Keyword density – target keyword (15 pts)
  const targetCount = countOccurrences(text, input.targetKeyword)
  if (targetCount >= 6) score += 15
  else if (targetCount >= 4) score += 10
  else if (targetCount >= 2) score += 5
  else if (targetCount >= 1) score += 2

  // 6. Semantic keyword coverage (15 pts)
  const semanticCovered = input.semanticKeywords.filter(kw =>
    countOccurrences(text, kw) >= 1
  ).length
  const semanticTotal = input.semanticKeywords.length || 1
  const semanticRatio = semanticCovered / semanticTotal
  score += Math.round(semanticRatio * 15)

  // 7. Subheadings (5 pts)
  const h2Count = input.h2Count ?? (input.bodyContent.match(/##|<h2/gi) || []).length
  if (h2Count >= 2) score += 5
  else if (h2Count >= 1) score += 3

  // 8. Internal links (5 pts) - detect from markdown links, URLs, and HTML
  let internalLinks = input.internalLinks ?? 0
  
  // If no links passed from scraper, try to detect from content
  if (internalLinks === 0) {
    const allContent = input.bodyContent + ' ' + input.pageTitle + ' ' + input.metaDescription
    // Count markdown links [text](url)
    const markdownLinks = (allContent.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length
    // Count plain URLs (http:// or https://)
    const plainUrls = (allContent.match(/https?:\/\/[^\s<>"]+/gi) || []).length
    // Count HTML anchor tags
    const htmlLinks = (allContent.match(/<a[^>]+href/gi) || []).length
    
    internalLinks = markdownLinks + plainUrls + htmlLinks
  }
  
  if (internalLinks >= 1) score += 5

  const percentage = Math.min(Math.round(score), 100)

  // ── KEYWORD TABLE ─────────────────────────────────────────────────────────
  const keywordResults: KeywordResult[] = allKeywords.map(kw => {
    const count = countOccurrences(text, kw)
    const isTarget = kw === input.targetKeyword
    const recMin = isTarget ? 5 : 2
    const recMax = isTarget ? 9 : 4

    let status: KeywordStatus
    if (count === 0) status = 'Mangler'
    else if (count < recMin) status = 'Optimer'
    else status = 'God'

    return { keyword: kw, status, currentCount: count, recommendedMin: recMin, recommendedMax: recMax }
  })

  const keywordsFound = keywordResults.filter(k => k.status === 'God').length
  const keywordsOptimise = keywordResults.filter(k => k.status === 'Optimer').length
  const keywordsMissing = keywordResults.filter(k => k.status === 'Mangler').length

  // ── RECOMMENDATIONS ──────────────────────────────────────────────────────
  const recommendations: RecommendationItem[] = [
    {
      id: 'title',
      label: 'Title Tag',
      status: titleHasKeyword && titleGoodLength ? 'ok' : titleHasKeyword ? 'warn' : 'error',
      statusLabel: titleHasKeyword && titleGoodLength ? 'Optimised' : titleHasKeyword ? '1 advarsel' : '1 fejl',
      detail: titleHasKeyword
        ? titleGoodLength
          ? `Title tag er god (${input.pageTitle.length} tegn) og indeholder target keyword.`
          : `Title tag indeholder keyword, men er ${input.pageTitle.length} tegn. Optimal længde: 30–65 tegn.`
        : `Title tag mangler target keyword "${input.targetKeyword}". Tilføj det gerne tidligt i titlen.`,
    },
    {
      id: 'h1',
      label: 'H1',
      status: h1HasKeyword ? 'ok' : h1Present ? 'warn' : 'error',
      statusLabel: h1HasKeyword ? 'Optimised' : h1Present ? '1 advarsel' : '1 fejl',
      detail: h1HasKeyword
        ? `H1 er optimeret og indeholder "${input.targetKeyword}".`
        : h1Present
        ? `H1 er til stede, men mangler target keyword. Nuværende H1: "${input.h1}"`
        : `Ingen H1 fundet. Tilføj en H1 med target keyword.`,
    },
    {
      id: 'subheadings',
      label: 'Subheadings',
      status: h2Count >= 2 ? 'ok' : h2Count >= 1 ? 'warn' : 'error',
      statusLabel: h2Count >= 2 ? 'Optimised' : `${h2Count} fundet`,
      detail: h2Count >= 2
        ? `${h2Count} H2-overskrifter fundet. God struktur.`
        : `Kun ${h2Count} H2 fundet. Tilsæt flere underoverskrifter der dækker semantiske keywords.`,
    },
    {
      id: 'content',
      label: 'Content Length',
      status: wordCount >= 500 ? 'ok' : wordCount >= 300 ? 'warn' : 'error',
      statusLabel: wordCount >= 500 ? 'Optimised' : '1 fejl',
      detail: `Siden har ~${wordCount} ord. ${
        wordCount >= 800
          ? 'Fremragende indholdslængde.'
          : wordCount >= 500
          ? 'God, men konkurrenter har typisk 800+ ord.'
          : 'For kort. Google foretrækker 500–800+ ord for konkurrencedygtige søgetermer. Brug handlingsplanen nedenfor til at tilføje indhold.'
      }`,
    },
    {
      id: 'links',
      label: 'Internal Links',
      status: internalLinks >= 1 ? 'ok' : 'error',
      statusLabel: internalLinks >= 1 ? 'Optimised' : '0 fundet',
      detail: internalLinks >= 1
        ? `${internalLinks} ${internalLinks === 1 ? 'internt link' : 'interne links'} fundet. ${internalLinks === 1 ? 'Ét relevant link er bedre end mange irrelevante.' : 'God intern linking.'}`
        : `Ingen interne links fundet. Tilsæt mindst ét relevant link til en relateret side.`,
    },
    {
      id: 'meta',
      label: 'Meta Description',
      status: metaHasKeyword && metaGoodLength ? 'ok' : metaHasKeyword ? 'warn' : 'error',
      statusLabel: metaHasKeyword && metaGoodLength ? 'Optimised' : '1 fejl',
      detail: metaHasKeyword
        ? metaGoodLength
          ? `Meta description er optimeret (${input.metaDescription.length} tegn).`
          : `Meta description indeholder keyword, men er ${input.metaDescription.length} tegn. Optimal: 120–160 tegn.`
        : `Meta description mangler target keyword og/eller er for ${input.metaDescription.length < 120 ? 'kort' : 'lang'} (${input.metaDescription.length} tegn). Optimal: 120–160 tegn.`,
    },
    {
      id: 'faq',
      label: 'FAQ Section',
      status: (() => {
        const allText = (input.bodyContent + input.h1 + input.pageTitle).toLowerCase()
        // Remove markdown formatting (_, *, #) before checking
        const cleanText = allText.replace(/[_*#]/g, '')
        const hasFaq = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a|questions)/i.test(cleanText)
        return hasFaq ? 'ok' : 'warn'
      })(),
      statusLabel: (() => {
        const allText = (input.bodyContent + input.h1 + input.pageTitle).toLowerCase()
        const cleanText = allText.replace(/[_*#]/g, '')
        const hasFaq = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a|questions)/i.test(cleanText)
        return hasFaq ? 'Optimised' : '1 advarsel'
      })(),
      detail: (() => {
        const allText = (input.bodyContent + input.h1 + input.pageTitle).toLowerCase()
        const cleanText = allText.replace(/[_*#]/g, '')
        const hasFaq = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a|questions)/i.test(cleanText)
        return hasFaq
          ? 'FAQ-sektion fundet. Sørg for at tilføje JSON-LD structured data for at trigger rich snippets i Google.'
          : 'Ingen FAQ-sektion fundet. Tilføj 3-5 spørgsmål/svar med JSON-LD structured data for bedre SERP-synlighed.'
      })(),
    },
  ]

  // ── CONTENT GAPS (dynamic) ────────────────────────────────────────────────
  const missingKeywords = keywordResults.filter(k => k.status === 'Mangler').map(k => k.keyword)

  const contentGaps: ContentGap[] = [
    {
      num: 'Gap 01 · Indholdslængde',
      tag: '#4f7fff',
      title: wordCount < 500 ? 'Siden er for kort' : 'Indholdsdybde',
      description:
        wordCount < 500
          ? `Med kun ~${wordCount} ord er siden for tyndt indholdsalt. Konkurrenter har typisk 600–1000+ ord på tilsvarende kategorisider.`
          : `Siden har ${wordCount} ord. Overvej at uddybe med produktspecifikke detaljer og FAQ for at styrke autoriteten.`,
      color: '#4f7fff',
    },
    {
      num: 'Gap 02 · Manglende keywords',
      tag: '#ff7043',
      title: missingKeywords.length > 0 ? `${missingKeywords.length} keywords mangler` : 'Semantisk dækning',
      description:
        missingKeywords.length > 0
          ? `Disse keywords er ikke fundet på siden: ${missingKeywords.slice(0, 4).join(', ')}${missingKeywords.length > 4 ? ' m.fl.' : ''}. Inkludér dem naturligt i brødtekst og overskrifter.`
          : `Alle semantiske keywords er dækket. Overvej yderligere long-tail varianter for at fange mere trafik.',`,
      color: '#ff7043',
    },
    {
      num: 'Gap 03 · Strukturerede data',
      tag: '#2dce89',
      title: 'FAQ + JSON-LD mangler',
      description: `Siden mangler sandsynligvis FAQ-sektion med JSON-LD structured data. Dette trigger rich snippets i Google og øger CTR markant for B2B-søgninger.`,
      color: '#2dce89',
    },
  ]

  // ── QUICK WINS ────────────────────────────────────────────────────────────
  const quickWins: SeoResult['quickWins'] = []

  if (!metaHasKeyword || !metaGoodLength) {
    quickWins.push({
      priority: 'red',
      title: 'Opdatér meta description',
      detail: `Tilføj "${input.targetKeyword}" og ${missingKeywords.slice(0, 2).join(', ')} til meta beskrivelsen. Direkte CTR-effekt i SERP.`,
    })
  }
  if (wordCount < 500) {
    quickWins.push({
      priority: 'red',
      title: 'Tilføj mere indhold (~300 ord)',
      detail: `Siden har kun ${wordCount} ord. Skriv et nyt afsnit der naturligt inkluderer de manglende keywords.`,
    })
  }
  if (missingKeywords.length > 0) {
    quickWins.push({
      priority: 'yellow',
      title: 'Inkludér manglende semantiske keywords',
      detail: `Brug ${missingKeywords.slice(0, 3).join(', ')} naturligt i brødtekst, produktbeskrivelser eller FAQ.`,
    })
  }
  
  // Only suggest FAQ if not already present
  const allText = (input.bodyContent + input.h1 + input.pageTitle).toLowerCase()
  const cleanText = allText.replace(/[_*#]/g, '')
  const hasFaq = /(faq|ofte stillede spørgsmål|spørgsmål og svar|q&a|questions)/i.test(cleanText)
  
  if (!hasFaq) {
    quickWins.push({
      priority: 'yellow',
      title: 'Tilføj FAQ-sektion med JSON-LD',
      detail: '3–5 spørgsmål og svar trigger rich snippets i Google og øger synlighed uden link-building.',
    })
  }
  if (internalLinks < 3) {
    quickWins.push({
      priority: 'green',
      title: 'Byg interne links fra relaterede sider',
      detail: 'Link til denne side fra relaterede kategorier med naturlige ankertekster der inkluderer target keyword.',
    })
  }

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
  }
}
