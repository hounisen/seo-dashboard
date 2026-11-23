// lib/serpAnalysis.ts
// Klassificerer Ahrefs SERP-resultater og vurderer, om søgeresultaterne passer til den analyserede sides type.
// Klassifikationen er en vurdering ud fra Ahrefs' AI-forudsagte sidetype (hvor den findes) samt titel/URL – ikke et bevis.

export interface SerpPosition {
  position: number
  title: string | null
  url: string | null
  pageType: string | null
  types: string[]
  updateDate: string
  domainRating: number | null
  traffic: number | null
}

export interface SerpData {
  keyword: string
  country: string
  fetchedAt: string // ISO – hvornår vi hentede data
  source: 'ahrefs'
  positions: SerpPosition[]
}

export type PageKind = 'kategori' | 'produkt' | 'artikel' | 'forside' | 'service' | 'ukendt'
export type PageTypeInput = '' | 'kategori' | 'produkt' | 'artikel' | 'branche' | 'service'

export interface ClassifiedResult {
  position: number
  title: string
  url: string
  kind: PageKind
  basis: 'ahrefs' | 'heuristik'
  pageTypeRaw: string | null
  updateDate: string
}

export interface SerpAnalysis {
  keyword: string
  fetchedAt: string
  dataDate: string // Ahrefs' dato for SERP-målingen
  organicCount: number
  results: ClassifiedResult[]
  shares: Partial<Record<PageKind, number>>
  dominant: PageKind
  probableIntent: string
  compatibleShare: number | null // andel resultater, der er samme sidetype som den analyserede side
  b2cSignals: number
  verdict: 'primaer' | 'sekundaer' | 'fravaelg' | 'usikker'
  uncertain: boolean
  reasons: string[]
}

export const KIND_LABEL: Record<PageKind, string> = {
  kategori: 'Kategori/produktliste',
  produkt: 'Produktside',
  artikel: 'Artikel/guide',
  forside: 'Forside',
  service: 'Service',
  ukendt: 'Ukendt',
}

function classifyOne(p: SerpPosition): { kind: PageKind; basis: 'ahrefs' | 'heuristik' } {
  const pt = (p.pageType || '').toLowerCase()
  if (pt) {
    if (pt.includes('homepage') || pt.includes('/core_page')) return { kind: 'forside', basis: 'ahrefs' }
    if (pt.includes('listing_collection') || pt.includes('landing_page')) return { kind: 'kategori', basis: 'ahrefs' }
    if (pt.includes('product_detail') || pt.includes('/product') && !pt.includes('listing') && !pt.includes('landing')) return { kind: 'produkt', basis: 'ahrefs' }
    if (pt.includes('/article') || pt.includes('blog') || pt.includes('guide') || pt.includes('how_to') || pt.includes('news')) return { kind: 'artikel', basis: 'ahrefs' }
    if (pt.includes('service')) return { kind: 'service', basis: 'ahrefs' }
  }
  const url = (p.url || '').toLowerCase()
  const title = (p.title || '').toLowerCase()
  try {
    const path = new URL(url).pathname
    if (path === '/' || path === '') return { kind: 'forside', basis: 'heuristik' }
  } catch { /* ignorer */ }
  if (/\/(blog|artikel|artikler|guide|viden|nyheder|magasin)\b|hvordan|sådan |guide til/.test(url + ' ' + title)) return { kind: 'artikel', basis: 'heuristik' }
  if (/\/(shop|webshop|kategori|category|produkter|products|c\/)\b|\/c-\d/.test(url)) return { kind: 'kategori', basis: 'heuristik' }
  if (/\/(p|produkt|product)\//.test(url)) return { kind: 'produkt', basis: 'heuristik' }
  return { kind: 'ukendt', basis: 'heuristik' }
}

// Hvilke SERP-typer regnes som "samme type" som den analyserede side?
function compatibleKinds(pageType: PageTypeInput): PageKind[] {
  switch (pageType) {
    case 'kategori': return ['kategori']
    case 'branche': return ['kategori', 'forside']
    case 'produkt': return ['produkt']
    case 'artikel': return ['artikel']
    case 'service': return ['service']
    default: return []
  }
}

export function analyzeSerp(data: SerpData, pageType: PageTypeInput): SerpAnalysis {
  const organic = data.positions.filter(p => p.types.includes('organic') && p.url)
  const results: ClassifiedResult[] = organic.map(p => {
    const c = classifyOne(p)
    return { position: p.position, title: p.title || '', url: p.url || '', kind: c.kind, basis: c.basis, pageTypeRaw: p.pageType, updateDate: p.updateDate }
  })
  const n = results.length
  const shares: Partial<Record<PageKind, number>> = {}
  for (const r of results) shares[r.kind] = (shares[r.kind] ?? 0) + 1 / Math.max(n, 1)
  const known = results.filter(r => r.kind !== 'ukendt')
  const dominant = (Object.entries(shares).filter(([k]) => k !== 'ukendt').sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as PageKind) || 'ukendt'
  const heuristicShare = n > 0 ? results.filter(r => r.basis === 'heuristik').length / n : 1
  const b2cSignals = results.filter(r => /\bprivate?\b|til hjemmet|børn|forbruger|\bhjem\b/i.test(r.title)).length
  const uncertain = n < 5 || known.length < Math.ceil(n * 0.6) || heuristicShare > 0.5

  const intent =
    dominant === 'artikel' ? 'Informativ (artikler/guides dominerer)'
    : dominant === 'kategori' || dominant === 'produkt' || dominant === 'forside' ? 'Kommerciel/transaktionel (butikker og kategorisider dominerer)'
    : dominant === 'service' ? 'Service/leverandør' : 'Uklar'

  const compat = compatibleKinds(pageType)
  const compatibleShare = compat.length > 0 && n > 0 ? results.filter(r => compat.includes(r.kind)).length / n : null

  const reasons: string[] = []
  if (n === 0) reasons.push('Ahrefs har ingen organiske SERP-resultater for søgeordet (typisk fordi søgeordet ikke har registreret søgevolumen).')
  else {
    const parts = Object.entries(shares).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([k, v]) => `${Math.round((v ?? 0) * n)} × ${KIND_LABEL[k as PageKind].toLowerCase()}`)
    reasons.push(`Top ${n} organiske resultater: ${parts.join(', ')}.`)
    reasons.push(`Sandsynlig søgeintention: ${intent}.`)
  }
  if (b2cSignals > 0) reasons.push(`${b2cSignals} resultat(er) har titler med forbruger-/private-signaler – kontrollér, om søgningen er relevant for B2B.`)
  if (uncertain && n > 0) reasons.push('Klassifikationen er usikker: få resultater, mange uden sidetype fra Ahrefs eller baseret på titel/URL.')

  let verdict: SerpAnalysis['verdict'] = 'usikker'
  if (n >= 5 && compatibleShare !== null) {
    if (compatibleShare >= 0.5) verdict = 'primaer'
    else if (compatibleShare >= 0.3) verdict = 'sekundaer'
    else verdict = 'fravaelg'
    reasons.push(`${Math.round(compatibleShare * 100)} % af resultaterne er samme sidetype som din side (${pageType}).`)
  } else if (n >= 5 && compatibleShare === null) {
    reasons.push('Angiv sidetype (kategori, produkt, artikel, branche eller service) for at vurdere, om SERP passer til siden.')
  }

  return { keyword: data.keyword, fetchedAt: data.fetchedAt, dataDate: organic[0]?.updateDate ?? data.positions[0]?.updateDate ?? '', organicCount: n, results, shares, dominant, probableIntent: intent, compatibleShare, b2cSignals, verdict, uncertain, reasons }
}
