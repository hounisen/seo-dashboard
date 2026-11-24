// lib/actionPlan.ts
// URL-specifik SEO-handlingsplan: én vurdering pr. Hounisen-URL, der er synlig i GSC/Ahrefs.
// Ren logik. Bygger på dashboardets eksisterende data (GSC query×page, Ahrefs, overlap, brief) og opfinder intet.
// Regler: GSC-tal alene giver aldrig OPTIMÉR for en anden URL end den analyserede; konkrete ændringer kræver indlæst indhold.
import { buildPerformance, normUrl, lastMeaningful, sameFamily, urlKind, GscPageRow, AhrefsUrlRow, PeriodInfo, OverlapResult, UrlKind } from './overlap'
import { Brief, classifyTrend } from './suggestBrief'

export type PlanAction = 'BEHOLD' | 'OPTIMÉR' | 'UNDERSØG' | 'INGEN HANDLING'
export type PlanPriority = 'høj' | 'middel' | 'lav'
type Slot = { clicks: number; impressions: number; ctr: number | null; position: number | null }
export interface PlanKeyword { keyword: string; cur: Slot | null; prev: Slot | null; sharedWith: number; ahrefsShift: string | null }
export interface PlanEntry {
  url: string
  key: string
  isActive: boolean
  topic: string
  kind: UrlKind
  keywords: PlanKeyword[]
  totals: { cur: { clicks: number; impressions: number } | null; prev: { clicks: number; impressions: number } | null }
  avgPosition: { cur: number | null; prev: number | null }
  action: PlanAction
  priority: PlanPriority
  reason: string
  documentation: 'verificeret' | 'foreløbig'
  documentationNote: string
  contentExamined: boolean
  variantOfActive: boolean
  sources: ('GSC' | 'Ahrefs')[]
  topKeyword: string
  todo: string
  significance: 'Stor' | 'Mellem' | 'Lille' | 'Ukendt'
}
export interface ActionPlan {
  available: boolean
  summary: string[]
  hidden: PlanEntry[]
  entries: PlanEntry[]
  notes: string[]
  periods: { current: string | null; previous: string | null }
}
// Hvad der vides om en URLs undersøgte indhold (gemte forslag for URL'en)
export interface ExaminedInfo { hasItems: boolean; behold: boolean | null; reason: string; itemCount: number }

export const MAX_PLAN_URLS = 5
const MIN_URL_IMP = 20
const STOPW = new Set(['og', 'i', 'til', 'af', 'på', 'for', 'med', 'en', 'et', 'den', 'det', 'de'])
const groupKey = (k: string) => k.toLowerCase().split(/[^a-zæøå0-9%]+/).filter(w => w && !STOPW.has(w)).sort().join(' ')
const MIN_TOTAL = 100
const fmt = (n: number) => n.toLocaleString('da-DK')

export function humanTopic(url: string): string {
  const s = lastMeaningful(url)
  const t = s.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : url
}

function wavg(rows: { slot: Slot | null }[]): number | null {
  const x = rows.filter(r => r.slot && r.slot.position != null && r.slot.position > 0 && r.slot.impressions > 0)
  const w = x.reduce((a, r) => a + r.slot!.impressions, 0)
  return w ? Math.round(x.reduce((a, r) => a + r.slot!.position! * r.slot!.impressions, 0) / w * 10) / 10 : null
}

export function buildActionPlan(args: {
  pageUrl: string
  gscPages?: GscPageRow[]
  periodInfo?: PeriodInfo
  validationError?: string
  ahrefsUrls?: AhrefsUrlRow[]
  overlap?: OverlapResult
  brief?: Brief
  activeContentLoaded: boolean
  examined?: Record<string, ExaminedInfo>   // nøgle = normUrl
}): ActionPlan {
  const { pageUrl, gscPages, periodInfo, validationError, ahrefsUrls, brief } = args
  const empty: ActionPlan = { available: false, summary: [], hidden: [], entries: [], notes: [], periods: { current: null, previous: null } }
  if (!gscPages || gscPages.length === 0) {
    // Ny side eller ingen GSC-historik: planen består af den analyserede side og bygger på on-page, SERP og B2B-vurdering
    const probs = brief?.documentedProblems ?? []
    const e: PlanEntry = {
      url: pageUrl, key: normUrl(pageUrl) || '(ingen-url)', isActive: true, topic: pageUrl ? humanTopic(pageUrl) : 'Den analyserede side', kind: pageUrl ? urlKind(pageUrl) : 'ukendt', keywords: [],
      totals: { cur: null, prev: null }, avgPosition: { cur: null, prev: null },
      action: probs.length ? 'OPTIMÉR' : 'UNDERSØG', priority: probs.length ? 'høj' : 'middel',
      reason: probs.length ? `Dokumenteret problem: ${probs[0]}` : 'Ingen GSC-historik at vurdere efter – bed om tekstforslag på baggrund af on-page-analyse, SERP og B2B-vurdering.',
      documentation: 'foreløbig', documentationNote: 'Ingen GSC-data: vurderingen bygger på sidens indhold, SERP og B2B-vurdering. Der kræves ingen historik.',
      contentExamined: args.activeContentLoaded, variantOfActive: false, sources: [], topKeyword: '',
      todo: probs.length ? 'Generér tekstforslag og gennemgå dem nedenfor.' : 'Bed om tekstforslag nedenfor for at få en dokumenteret vurdering.', significance: 'Ukendt',
    }
    return { available: true, summary: [`Ingen GSC-historik er indlæst – handlingsplanen omfatter kun den analyserede side.`, `${e.action}: ${e.reason}`, 'Forslagene bygger på on-page, SERP og B2B-vurdering og er foreløbige, til der er performancedata.'], hidden: [], entries: [e], notes: [], periods: { current: null, previous: null } }
  }
  if (validationError || !periodInfo || periodInfo.status === 'uklar') return { ...empty, notes: [`Datavalideringsfejl i GSC-perioderne: ${validationError || periodInfo?.error || 'perioderne kan ikke identificeres entydigt.'} Handlingsplanen er stoppet.`] }
  const me = normUrl(pageUrl)
  const examined = args.examined ?? {}

  // Alle distinkte URL'er (normaliseret) fra GSC, den analyserede URL og Ahrefs
  const urlMap = new Map<string, { url: string; sources: Set<'GSC' | 'Ahrefs'> }>()
  const add = (u: string, src: 'GSC' | 'Ahrefs') => { const k = normUrl(u); if (!k) return; const e = urlMap.get(k) ?? { url: u, sources: new Set<'GSC' | 'Ahrefs'>() }; e.sources.add(src); urlMap.set(k, e) }
  for (const r of gscPages) add(r.page, 'GSC')
  if (me) { if (!urlMap.has(me)) add(pageUrl, 'GSC'); }
  for (const a of ahrefsUrls ?? []) for (const u of [a.prevUrl, a.currUrl]) if (u) add(u, 'Ahrefs')
  const myHost = me.split('/')[0]
  const keys = Array.from(urlMap.keys()).filter(k => k === me || k.split('/')[0] === myHost || !me)

  // Pr. søgeord: hvilke URL'er har aktuel synlighed
  const kwUrls = new Map<string, Set<string>>()
  for (const r of gscPages) {
    if (r.period !== periodInfo.current || r.impressions < MIN_URL_IMP) continue
    const k = r.query.toLowerCase().trim(), u = normUrl(r.page)
    const s = kwUrls.get(k) ?? new Set<string>(); s.add(u); kwUrls.set(k, s)
  }
  const shift = new Map<string, { prev: string; curr: string }>()
  for (const a of ahrefsUrls ?? []) if (a.prevUrl && a.currUrl && normUrl(a.prevUrl) !== normUrl(a.currUrl)) shift.set(a.keyword.toLowerCase().trim(), { prev: normUrl(a.prevUrl), curr: normUrl(a.currUrl) })

  const entries: PlanEntry[] = []
  for (const key of keys) {
    const info = urlMap.get(key)!
    const isActive = key === me
    const perf = buildPerformance(gscPages, periodInfo, info.url)
    const inGsc = info.sources.has('GSC') && perf.rows.length > 0
    const kws: PlanKeyword[] = perf.rows.map(r => {
      const k = r.keyword.toLowerCase().trim()
      const others = Array.from(kwUrls.get(k) ?? []).filter(u => u !== key).length
      const sh = shift.get(k)
      const involved = sh && (sh.prev === key || sh.curr === key)
      return { keyword: r.keyword, cur: r.cur, prev: r.prev, sharedWith: (r.cur && r.cur.impressions >= MIN_URL_IMP) || (r.prev && r.prev.impressions >= MIN_URL_IMP) ? others : 0, ahrefsShift: involved ? (sh!.prev === key ? 'Ahrefs: rangerede tidligere med denne URL, nu en anden' : 'Ahrefs: er nu den rangerende URL (tidligere en anden)') : null }
    })
    // Relevante overlappende søgeord først (delt med andre URL'er), derefter egne eksponeringer
    const shared = kws.filter(k => k.sharedWith > 0 || k.ahrefsShift).sort((a, b) => (b.cur?.impressions ?? 0) - (a.cur?.impressions ?? 0))
    // Ensartede søgeord (samme ord uden stopord, fx «x dansk» / «x på dansk») grupperes til én linje med summerede tal
    const grouped: PlanKeyword[] = []
    const byKey = new Map<string, PlanKeyword>()
    for (const k of shared) {
      const gk = groupKey(k.keyword), ex0 = byKey.get(gk)
      if (!ex0) { const c = { ...k }; byKey.set(gk, c); grouped.push(c); continue }
      const m = (a: Slot | null, b: Slot | null): Slot | null => { if (!a || !b) return a || b; const ti = a.impressions + b.impressions, tc = a.clicks + b.clicks; const pos = a.position != null && b.position != null && ti > 0 ? (a.position * a.impressions + b.position * b.impressions) / ti : a.position ?? b.position; return { clicks: tc, impressions: ti, ctr: ti > 0 ? tc / ti : null, position: pos } }
      ex0.cur = m(ex0.cur, k.cur); ex0.prev = m(ex0.prev, k.prev); ex0.keyword = `${ex0.keyword} (+ «${k.keyword}»)`; ex0.ahrefsShift = ex0.ahrefsShift || k.ahrefsShift; ex0.sharedWith = Math.max(ex0.sharedWith, k.sharedWith)
    }
    const keywords = grouped.slice(0, 5)
    const totals = perf.totals
    const curImp = totals.cur?.impressions ?? 0, prevImp = totals.prev?.impressions ?? 0
    const topKw = kws[0]?.keyword ?? ''
    const variantOfActive = !isActive && !!me && sameFamily(info.url, pageUrl)
    const trend = totals.cur && totals.prev ? classifyTrend({ ...totals.cur, ctr: null, position: null }, { ...totals.prev, ctr: null, position: null }).trend : 'for-faa-data'
    const ex = examined[key]
    const contentExamined = isActive ? args.activeContentLoaded : !!ex
    let action: PlanAction, priority: PlanPriority, reason: string

    if (!inGsc) {
      action = 'UNDERSØG'; priority = 'lav'
      reason = 'URL\'en optræder kun i Ahrefs-filen (ingen GSC-rækker). Verificér først, om den stadig findes og får synlighed.'
    } else if (isActive) {
      const g = brief?.gate
      if (ex && ex.hasItems) { action = 'OPTIMÉR'; priority = 'høj'; reason = `Der er gemt ${ex.itemCount} tekstforslag til denne URL – se konkrete forslag nedenfor.` }
      else if (ex && ex.behold) { action = 'BEHOLD'; priority = 'lav'; reason = ex.reason || 'Claude vurderede, at eksisterende indhold bør bevares.' }
      else if (g?.recommendBehold) { action = 'BEHOLD'; priority = 'lav'; reason = `Stigende klik uden tilbagegang på de største søgeord og uden dokumenterede problemer. ${trend === 'fremgang' || (totals.cur && totals.prev && totals.cur.clicks > totals.prev.clicks) ? `Klik ${fmt(totals.prev?.clicks ?? 0)} → ${fmt(totals.cur?.clicks ?? 0)}.` : ''}`.trim() }
      else if (brief && brief.documentedProblems.length > 0) { action = 'OPTIMÉR'; priority = 'høj'; reason = `Dokumenteret problem: ${brief.documentedProblems[0]}` }
      else { action = 'UNDERSØG'; priority = 'middel'; reason = 'Ingen entydigt dokumenteret problem eller bevaringsgrund – bed om tekstforslag for at få en begrundet vurdering.' }
    } else if (ex) {
      // Indhold indlæst og analyseret: vurdering bygger på sidens egen tekst
      if (ex.hasItems) { action = 'OPTIMÉR'; priority = curImp >= 1000 ? 'høj' : 'middel'; reason = `Indholdet er indlæst og analyseret: ${ex.itemCount} konkrete forslag.` }
      else if (ex.behold) { action = 'BEHOLD'; priority = 'lav'; reason = ex.reason || 'Indholdet er indlæst; Claude fandt ingen dokumenteret grund til ændring.' }
      else { action = 'UNDERSØG'; priority = 'middel'; reason = 'Indholdet er indlæst, men analysen gav hverken forslag eller en bevaringsvurdering.' }
    } else if (curImp < MIN_TOTAL && prevImp < MIN_TOTAL) {
      action = 'INGEN HANDLING'; priority = 'lav'; reason = `For få data (${fmt(curImp)} eksponeringer i aktuel periode, ${fmt(prevImp)} i sammenligningen) til en vurdering.`
    } else if (trend === 'tilbagegang' || trend === 'forsvundet') {
      action = 'UNDERSØG'; priority = curImp >= 1000 || prevImp >= 1000 ? 'høj' : 'middel'
      reason = `Klik ${fmt(totals.prev?.clicks ?? 0)} → ${fmt(totals.cur?.clicks ?? 0)}. Årsagen er ukendt (sæson, SERP-ændring, konkurrenter eller overlap) – undersøg før ændring.`
    } else if (keywords.length > 0 && variantOfActive) {
      action = 'INGEN HANDLING'; priority = 'lav'; reason = 'Produktvariant af den analyserede side: overlappet er legitimt og er ikke i sig selv kannibalisering.'
    } else if (keywords.length > 0) {
      const lead = keywords[0]
      action = 'UNDERSØG'; priority = curImp >= 1000 ? 'høj' : 'middel'
      reason = `Rangerer på samme søgeord som andre Hounisen-URL'er (fx «${lead.keyword}», ${fmt(lead.cur?.impressions ?? 0)} eksp.). Undersøg, om siderne opfylder forskellige intentioner eller produktbehov. Ingen konklusion om kannibalisering.`
    } else {
      action = 'BEHOLD'; priority = 'lav'; reason = `Ingen overlap med andre URL'er og ingen tilbagegang i GSC (klik ${fmt(totals.prev?.clicks ?? 0)} → ${fmt(totals.cur?.clicks ?? 0)}). Sidens indhold er ikke undersøgt.`
    }

    const documentation: PlanEntry['documentation'] = isActive ? (args.activeContentLoaded && perf.status === 'ok' ? 'verificeret' : 'foreløbig') : (ex && inGsc ? 'verificeret' : 'foreløbig')
    const documentationNote = isActive
      ? (documentation === 'verificeret' ? 'Sidens indhold er indlæst; tal fra GSC-filen for den aktuelle periode.' : 'Sidens indhold eller en sammenlignelig periode mangler – vurderingen er foreløbig.')
      : ex ? 'Sidens indhold er indlæst og analyseret.' : 'Kun GSC/Ahrefs-tal – sidens indhold er ikke undersøgt. Indlæs URL\'en for en supplerende analyse; konkrete tekstændringer genereres ikke ud fra GSC-tal alene.'
    const lead0 = keywords[0]
    const todo = isActive
      ? (action === 'OPTIMÉR' ? 'Gennemgå de konkrete tekstforslag nedenfor, og anvend, redigér eller afvis hver for sig.' : action === 'BEHOLD' ? 'Ingen tekstændring nødvendig nu. Følg udviklingen i næste GSC-periode.' : 'Bed om tekstforslag nedenfor for at få en dokumenteret vurdering.')
      : action === 'OPTIMÉR' ? 'Gennemgå de konkrete forslag til denne URL i detaljen. Intet er ændret på siden.'
      : action === 'INGEN HANDLING' ? 'Ingen handling.'
      : action === 'BEHOLD' ? 'Ingen handling nu. Følg udviklingen.'
      : trend === 'tilbagegang' || trend === 'forsvundet' ? 'Undersøg årsagen (sæson, SERP-ændring, konkurrenter, overlap) før noget ændres. Indlæs siden for en supplerende analyse.'
      : lead0 ? `Indlæs siden og vurdér, om den opfylder en anden søgeintention eller et andet produktbehov end den analyserede side på «${lead0.keyword.replace(/ \(\+ .*$/, '')}».` : 'Verificér, om URL\'en stadig findes og får synlighed.'
    const significance: PlanEntry['significance'] = !inGsc ? 'Ukendt' : action === 'INGEN HANDLING' || action === 'BEHOLD' ? 'Lille' : (curImp >= 3000 && (action === 'OPTIMÉR' || trend === 'tilbagegang' || trend === 'forsvundet')) ? 'Stor' : curImp >= 300 || prevImp >= 300 ? 'Mellem' : 'Lille'
    entries.push({
      todo, significance,
      url: info.url, key, isActive, topic: humanTopic(info.url), kind: urlKind(info.url), keywords, totals,
      avgPosition: { cur: wavg(perf.rows.map(r => ({ slot: r.cur }))), prev: wavg(perf.rows.map(r => ({ slot: r.prev }))) },
      action, priority, reason, documentation, documentationNote, contentExamined, variantOfActive,
      sources: Array.from(info.sources), topKeyword: topKw,
    })
  }
  const pr = { høj: 0, middel: 1, lav: 2 }
  entries.sort((a, b) => pr[a.priority] - pr[b.priority] || (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) || (b.totals.cur?.impressions ?? 0) - (a.totals.cur?.impressions ?? 0))
  const visible = entries.slice(0, MAX_PLAN_URLS)
  // Den analyserede URL vises altid
  const actIdx = entries.findIndex(x => x.isActive)
  if (actIdx >= MAX_PLAN_URLS) visible[MAX_PLAN_URLS - 1] = entries[actIdx]
  const hidden = entries.filter(x => visible.indexOf(x) < 0)
  const actE = entries.find(x => x.isActive), rel = visible.filter(x => !x.isActive)
  const count = (a: PlanAction) => rel.filter(x => x.action === a).length
  const summary: string[] = []
  if (actE) summary.push(`${actE.topic}: ${actE.action} – ${actE.reason}`)
  if (rel.length) summary.push(`${rel.length} relaterede URL'er: ${(['UNDERSØG', 'OPTIMÉR', 'BEHOLD', 'INGEN HANDLING'] as PlanAction[]).filter(a => count(a) > 0).map(a => `${count(a)} ${a}`).join(', ')}.`)
  const insight = rel.filter(x => x.action === 'UNDERSØG' && x.keywords[0]).sort((a, b) => (b.totals.cur?.impressions ?? 0) - (a.totals.cur?.impressions ?? 0))[0]
  if (insight) summary.push(`Vigtigste indsigt: «${insight.keywords[0].keyword.replace(/ \(\+ .*$/, '')}» er synligt på flere Hounisen-URL'er (${insight.topic}: ${fmt(insight.keywords[0].cur?.impressions ?? 0)} eksp.). Undersøg intentioner, før noget ændres.`)
  summary.push(`Kun den analyserede side er gennemgået indholdsmæssigt${hidden.length ? `; ${hidden.length} yderligere URL'er med lavere relevans er grupperet` : ''}. Vurderingerne af andre URL'er er foreløbige.`)
  const notes = ['Tal er summer af rækkerne i GSC-filen pr. URL og er ikke validerede totaler. Handlingerne er anbefalinger til undersøgelse eller redigering – intet ændres eller publiceres automatisk, og der foreslås hverken canonical, redirect eller sammenlægning.']
  return { available: entries.length > 0, summary: summary.slice(0, 4), hidden, entries: visible, notes, periods: { current: periodInfo.current, previous: periodInfo.previous } }
}
