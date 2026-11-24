// lib/suggestBrief.ts
// Beslutningsgrundlag til AI-forslag: udvikling (aktuel vs. sammenligning), forretningsrelevans, overlap og kritisk CTR-vurdering.
// Ren logik. Intet her er et klikestimat – kun observationer og tydeligt mærkede hypoteser.
import { containsKeyword, expectedCtr, normKw, SeoResult } from './seoEngine'

type Slot = { clicks: number; impressions: number; ctr: number | null; position: number | null }
export type BriefTrend = 'fremgang' | 'tilbagegang' | 'blandet' | 'stabil' | 'ny' | 'forsvundet' | 'for-faa-data'
export type BriefAction = 'behold' | 'undersoeg' | 'undersoeg-overlap' | 'hypotese-mulighed' | 'afvent-data'
export interface BriefKeyword {
  keyword: string
  current: Slot | null
  previous: Slot | null
  trend: BriefTrend
  deltaClicks: number | null
  deltaImpressions: number | null
  deltaPosition: number | null // negativ = bedre placering
  onPage: boolean
  coverage: 'dækket' | 'delvist' | 'mangler'
  missingWords: string[]
  relevance: { b2b: string; role: string; basis: string } | null
  overlap: { classification: string; otherActiveUrls: string[] } | null
  ctrNote: string | null
  action: BriefAction
  assessment: string
}
export interface Brief {
  dataStatus: 'ok' | 'enkelt' | 'valideringsfejl' | 'ingen'
  error?: string
  currentPeriod: string | null
  previousPeriod: string | null
  summary: string[]
  totals: { current: { clicks: number; impressions: number } | null; previous: { clicks: number; impressions: number } | null }
  keywords: BriefKeyword[]
  documentedProblems: string[]
  gate: { allowPerformanceBased: boolean; recommendBehold: boolean; reason: string }
  method: string
}

const MIN_IMP = 30
const COMMERCIAL = /\b(køb|købe|pris|priser|bestil|bestille|tilbud|leverandør|shop|online)\b/i
const STOP = new Set(['og', 'i', 'til', 'af', 'på', 'for', 'med', 'en', 'et', 'den', 'det', 'de'])
const words = (s: string) => s.toLowerCase().split(/[^a-zæøå0-9%]+/).filter(w => w && !STOP.has(w))

export function classifyTrend(cur: Slot | null, prev: Slot | null): { trend: BriefTrend; dClicks: number | null; dImps: number | null; dPos: number | null } {
  const ci = cur?.impressions ?? 0, pi = prev?.impressions ?? 0
  const dClicks = cur && prev ? cur.clicks - prev.clicks : null
  const dImps = cur && prev ? cur.impressions - prev.impressions : null
  const dPos = cur?.position != null && prev?.position != null && cur.position > 0 && prev.position > 0 ? Math.round((cur.position - prev.position) * 10) / 10 : null
  if (ci < MIN_IMP && pi < MIN_IMP) return { trend: 'for-faa-data', dClicks, dImps, dPos }
  if (!prev || pi === 0) return { trend: ci >= MIN_IMP ? 'ny' : 'for-faa-data', dClicks, dImps, dPos }
  if (!cur || ci === 0) return { trend: pi >= MIN_IMP ? 'forsvundet' : 'for-faa-data', dClicks, dImps, dPos }
  const relClicks = prev.clicks > 0 ? (cur.clicks - prev.clicks) / prev.clicks : cur.clicks > 0 ? 1 : 0
  const up = (dClicks! >= 5 && relClicks >= 0.25) || (dPos != null && dPos <= -1 && ci >= 100)
  const down = (dClicks! <= -5 && relClicks <= -0.25) || (dPos != null && dPos >= 1 && ci >= 100)
  return { trend: up && down ? 'blandet' : up ? 'fremgang' : down ? 'tilbagegang' : 'stabil', dClicks, dImps, dPos }
}

export function buildBrief(result: SeoResult, pageText: string): Brief {
  const perf = result.performance
  const method = 'Udvikling = aktuel periode sammenlignet med sammenligningsperioden for samme URL (GSC, forespørgsel × landingsside). Fremgang/tilbagegang kræver mindst 30 eksponeringer og enten ≥ 5 klik og ≥ 25 % ændring eller ≥ 1 placering ved ≥ 100 eksponeringer. CTR sammenlignes kun med en generisk benchmarkkurve og er en hypotese; der beregnes ingen estimerede ekstra klik.'
  const documentedProblems = result.recommendations.filter(r => r.kind === 'problem' && r.verdict === 'optimer').map(r => `${r.label}: ${r.observation}`)
  const base: Brief = { dataStatus: perf.status === 'ingen' ? 'ingen' : perf.status, error: perf.error, currentPeriod: perf.currentLabel, previousPeriod: perf.previousLabel, summary: [], totals: { current: perf.totals.cur, previous: perf.totals.prev }, keywords: [], documentedProblems, gate: { allowPerformanceBased: false, recommendBehold: false, reason: '' }, method }
  if (perf.status === 'valideringsfejl') { base.gate.reason = `Datavalideringsfejl i GSC-perioderne: ${perf.error} Performancebaserede forslag er stoppet.`; return base }
  if (perf.status === 'ingen' || !perf.urlFound) { base.gate.reason = perf.status === 'ingen' ? 'Ingen GSC-data med periodeangivelse er indlæst – forslag må ikke bygge på performance.' : 'Den analyserede URL findes ikke i GSC-filen – forslag må ikke bygge på performance.'; return base }

  const cands = result.focus.candidates
  const rows: BriefKeyword[] = perf.rows.slice(0, 12).map(r => {
    const t = classifyTrend(r.cur, r.prev)
    const kw = r.keyword
    const ws = words(kw)
    const missing = ws.filter(w => !containsKeyword(pageText, w))
    const coverage: BriefKeyword['coverage'] = containsKeyword(pageText, kw) ? 'dækket' : missing.length === 0 ? 'dækket' : missing.length < ws.length ? 'delvist' : 'mangler'
    const cand = cands.find(c => normKw(c.keyword) === normKw(kw))
    const ov = result.overlap.keywords.find(o => normKw(o.keyword) === normKw(kw))
    const otherActive = ov ? ov.urls.filter(u => !u.isCurrent && u.status === 'aktuel').map(u => u.url) : []
    const cur = r.cur
    let ctrNote: string | null = null
    if (cur && cur.impressions >= 50 && cur.position != null && cur.position > 0 && cur.ctr != null) {
      const exp = expectedCtr(cur.position)
      if (cur.ctr < 0.6 * exp) ctrNote = `CTR ${(cur.ctr * 100).toFixed(2)} % ligger under en generisk forventning på ca. ${(exp * 100).toFixed(1)} % ved placering ${cur.position.toFixed(1)}. Hypotese – benchmarken tager ikke højde for SERP-features, brand eller intention, og der beregnes ingen ekstra klik.`
    }
    let action: BriefAction = 'behold'
    let assessment = ''
    const commercial = COMMERCIAL.test(kw)
    if (ov && ['uhensigtsmaessigt', 'mulig-kannibalisering'].includes(ov.classification) && otherActive.length > 0) { action = 'undersoeg-overlap'; assessment = `Flere URL'er har aktuelle eksponeringer (${otherActive.length} andre). Undersøg, hvilken side der bedst opfylder intentionen, før denne side ændres.` }
    else if (ov && ov.classification === 'legitimt') assessment = 'Overlap med produktvarianter – normalt, ingen handling.'
    else if (t.trend === 'for-faa-data') { action = 'afvent-data'; assessment = 'For få eksponeringer til at vurdere udvikling eller mulighed.' }
    else if (t.trend === 'fremgang' && coverage === 'dækket') assessment = 'Fremgang og søgeordet er dækket på siden – behold det, der virker.'
    else if (t.trend === 'tilbagegang' || t.trend === 'forsvundet') { action = 'undersoeg'; assessment = 'Tilbagegang – årsagen er ukendt (sæson, SERP-ændring, konkurrenter eller overlap). Undersøg før ændring.' }
    else if (coverage !== 'dækket' && (cur?.impressions ?? 0) >= 50) { action = 'hypotese-mulighed'; assessment = `${commercial ? 'Kommerciel formulering. ' : ''}Søgningen har eksponeringer, men ${missing.length ? `ordene «${missing.join(', ')}» ` : 'søgeordet '}står ikke på siden. Om siden bør opfylde den, afhænger af sortiment, B2B-målgruppe og sidens konverteringsformål – hypotese, ikke dokumenteret mulighed.` }
    else assessment = t.trend === 'ny' ? 'Ny synlighed i aktuel periode.' : 'Stabil – ingen dokumenteret grund til ændring.'
    return {
      keyword: kw, current: r.cur, previous: r.prev, trend: t.trend, deltaClicks: t.dClicks, deltaImpressions: t.dImps, deltaPosition: t.dPos,
      onPage: containsKeyword(pageText, kw), coverage, missingWords: missing,
      relevance: cand ? { b2b: cand.b2b.overall, role: cand.role, basis: cand.b2b.basis } : null,
      overlap: ov ? { classification: ov.classification, otherActiveUrls: otherActive } : null,
      ctrNote, action, assessment,
    }
  })
  base.keywords = rows
  const t = perf.totals
  if (t.cur && t.prev) base.summary.push(`Klik ${t.prev.clicks.toLocaleString('da-DK')} → ${t.cur.clicks.toLocaleString('da-DK')}, eksponeringer ${t.prev.impressions.toLocaleString('da-DK')} → ${t.cur.impressions.toLocaleString('da-DK')} (summer af filens rækker for denne URL – ikke validerede totaler).`)
  const ups = rows.filter(r => r.trend === 'fremgang').map(r => r.keyword), downs = rows.filter(r => r.trend === 'tilbagegang' || r.trend === 'forsvundet').map(r => r.keyword)
  if (ups.length) base.summary.push(`Fremgang: ${ups.join(', ')}.`)
  if (downs.length) base.summary.push(`Tilbagegang: ${downs.join(', ')}.`)
  if (!perf.previousLabel) base.summary.push('Kun én periode – udvikling kan ikke vurderes.')

  base.gate.allowPerformanceBased = true
  const top = rows.slice(0, 3)
  const wPos = (sel: 'current' | 'previous') => { const x = rows.filter(r => r[sel]?.position && r[sel]!.impressions > 0); const w = x.reduce((a, r) => a + r[sel]!.impressions, 0); return w ? x.reduce((a, r) => a + r[sel]!.position! * r[sel]!.impressions, 0) / w : null }
  const pc = wPos('current'), pp = wPos('previous')
  const improving = !!(t.cur && t.prev && t.cur.clicks > t.prev.clicks && (pc == null || pp == null || pc <= pp + 0.2))
  const topDown = top.some(r => r.trend === 'tilbagegang' || r.trend === 'forsvundet')
  const noMatchTarget = cands.some(c => c.role === 'primaer' && c.b2b.overall === 'IKKE MATCH')
  if (perf.previousLabel && improving && !topDown && !noMatchTarget && documentedProblems.length === 0) {
    base.gate.recommendBehold = true
    base.gate.reason = 'Siden har stigende klik uden tilbagegang på de største søgeord og uden dokumenterede problemer fra dashboardets kontroller. Det taler for at bevare eksisterende indhold, men blokerer ikke forslag, der bygger på faktuelle fejl, forkerte produktdata, manglende oplysninger eller problemer med intention/konvertering. Ingen ændring alene for at hæve on-page-scoren.'
  } else base.gate.reason = 'Performance kan indgå i forslagene. Forslag skal bygge på dokumenterede observationer og tydeligt mærkede hypoteser.'
  return base
}

// Tal i GSC-påstande verificeres mod dashboardets egne målinger. Udokumenterede påstande nedgraderes til hypotese,
// men forslaget fjernes ikke, hvis det i øvrigt bygger på verificerede produktdata eller sidens indhold.
function numSet(kws: BriefKeyword[], totals?: Brief['totals']): Set<string> {
  const set = new Set<string>()
  const add = (n: number | null | undefined, ds: number[]) => { if (n == null) return; for (const d of ds) { const v = Math.abs(n).toFixed(d); set.add(v); set.add(v.replace('.', ',')); set.add(Number(v).toLocaleString('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d })) } }
  const slot = (x: Slot | null) => { if (!x) return; add(x.clicks, [0]); add(x.impressions, [0]); add(x.position, [0, 1]); if (x.ctr != null) add(x.ctr * 100, [1, 2]) }
  for (const k of kws) { slot(k.current); slot(k.previous); add(k.deltaClicks, [0]); add(k.deltaImpressions, [0]); add(k.deltaPosition, [1]) }
  if (totals) for (const t of [totals.current, totals.previous]) if (t) { add(t.clicks, [0]); add(t.impressions, [0]) }
  return set
}
// Tal i en sætning kontrolleres mod det søgeord, sætningen nævner. Uden nævnt søgeord kontrolleres kun mod sidens summer.
function namedKeywords(sent: string, brief: Brief): BriefKeyword[] {
  const l = sent.toLowerCase()
  const m = brief.keywords.filter(k => l.indexOf(k.keyword.toLowerCase()) >= 0)
  return m.filter(k => !m.some(o => o !== k && o.keyword.length > k.keyword.length && o.keyword.toLowerCase().indexOf(k.keyword.toLowerCase()) >= 0))
}
// Søgeord, der optræder selvstændigt i sætningen (ikke blot som del af et længere nævnt søgeord).
function standaloneKeywords(sent: string, brief: Brief): BriefKeyword[] {
  const l = sent.toLowerCase()
  const m = brief.keywords.filter(k => l.indexOf(k.keyword.toLowerCase()) >= 0).sort((x, y) => y.keyword.length - x.keyword.length)
  let rest = l
  const out: BriefKeyword[] = []
  for (const k of m) { const kl = k.keyword.toLowerCase(); if (rest.indexOf(kl) >= 0) { out.push(k); rest = rest.split(kl).join(' ') } }
  return out
}
const GSC_WORDS = /\b(GSC|Search Console)\b|\b(klik|eksponering(er)?|visning(er)?|CTR|placering)\b/i
const PREV_CUE = /\b(forrige|tidligere|previous|sammenligningsperiod\w*)\b/i
const CUR_CUE = /\b(aktuel\w*|ny periode|seneste|nuværende)\b/i
type Metric = 'clicks' | 'impressions' | 'ctr' | 'position'
// Måletype for et tal udledes kun af ordet lige ved tallet; ellers er måletypen ukendt (null).
function metricOf(sent: string, num: string, idx: number): Metric | null {
  const after = sent.slice(idx + num.length, idx + num.length + 22).toLowerCase()
  const before = sent.slice(Math.max(0, idx - 22), idx).toLowerCase()
  if (/^\s*%/.test(after) || /^\s*procent/.test(after) || /ctr\s*(på|var|er|:)?\s*$/.test(before)) return 'ctr'
  if (/^\s*klik/.test(after)) return 'clicks'
  if (/^\s*(eksponering|visning|impression)/.test(after)) return 'impressions'
  if (/(placering|position|gns\.?)\w*\s*(på|ca\.?|var|er|:)?\s*(ca\.?\s*)?$/.test(before)) return 'position'
  return null
}
function slotValues(kws: BriefKeyword[], metric: Metric | null, which: 'current' | 'previous' | 'both'): Set<string> {
  const set = new Set<string>()
  const add = (n: number | null | undefined, ds: number[]) => { if (n == null) return; for (const d of ds) { const v = Math.abs(n).toFixed(d); set.add(v); set.add(v.replace('.', ',')); set.add(Number(v).toLocaleString('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d })) } }
  for (const k of kws) for (const w of ['current', 'previous'] as const) {
    if (which !== 'both' && which !== w) continue
    const x = k[w]; if (!x) continue
    if (!metric || metric === 'clicks') add(x.clicks, [0])
    if (!metric || metric === 'impressions') add(x.impressions, [0])
    if (!metric || metric === 'position') add(x.position, [0, 1])
    if ((!metric || metric === 'ctr') && x.ctr != null) add(x.ctr * 100, [1, 2])
  }
  return set
}
function totalValues(brief: Brief, metric: Metric | null, which: 'current' | 'previous' | 'both'): Set<string> {
  const set = new Set<string>()
  const t = brief.totals
  for (const w of ['current', 'previous'] as const) {
    if (which !== 'both' && which !== w) continue
    const x = t?.[w]; if (!x) continue
    if (!metric || metric === 'clicks') { set.add(String(x.clicks)); set.add(x.clicks.toLocaleString('da-DK')) }
    if (!metric || metric === 'impressions') { set.add(String(x.impressions)); set.add(x.impressions.toLocaleString('da-DK')) }
  }
  return set
}
// Tal kontrolleres mod søgeordet, sætningen nævner (kun ét), mod den nævnte periode og mod måletypen lige ved tallet.
export function gscClaimVerified(text: string, brief?: Brief): boolean {
  if (!brief || !brief.gate.allowPerformanceBased) return !GSC_WORDS.test(text)
  const sentences = text.split(/[;]\s+|\.\s+(?=[A-ZÆØÅ«])/).filter(x => GSC_WORDS.test(x))
  for (const sent of sentences) {
    const named = namedKeywords(sent, brief)
    const which: 'current' | 'previous' | 'both' = PREV_CUE.test(sent) && !CUR_CUE.test(sent) ? 'previous' : CUR_CUE.test(sent) && !PREV_CUE.test(sent) ? 'current' : 'both'
    const re = /\d[\d.]*(?:,\d+)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(sent))) {
      const clean = m[0].replace(/\.$/, '')
      if (/^(19|20)\d\d$/.test(clean) || (/^\d{1,2}$/.test(clean) && /(måned|dage|uger|periode)/i.test(sent) && metricOf(sent, m[0], m.index) == null)) continue
      const metric = metricOf(sent, m[0], m.index)
      const ok = named.length ? slotValues(named, metric, which) : totalValues(brief, metric, which)
      if (!ok.has(clean) && !ok.has(clean.replace(/\./g, ''))) return false
    }
  }
  return true
}

// Retter eller udelader forkerte numeriske GSC-påstande i en tekst: en sætning med GSC-begreber og uverificerede tal
// erstattes af dashboardets verificerede aktuelle tal kun ved entydigt match (ét søgeord, aktuel periode) – ellers udelades den.
function fmtSlot(k: BriefKeyword): string {
  const c = k.current
  if (!c) return ''
  const n = (x: number, d = 0) => x.toLocaleString('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d })
  return `«${k.keyword}» (aktuel periode): ${n(c.clicks)} klik, ${n(c.impressions)} eksponeringer${c.ctr != null ? `, CTR ${n(c.ctr * 100, 2)} %` : ''}${c.position ? `, placering ${n(c.position, 1)}` : ''}`
}
export function fixGscClaims(text: string, brief?: Brief): { text: string; changed: number; removed: number } {
  if (!text || !GSC_WORDS.test(text)) return { text, changed: 0, removed: 0 }
  const parts = text.split(/\.\s+(?=[A-ZÆØÅ«])|;\s+/)
  let changed = 0, removed = 0
  const out: string[] = []
  for (const sent of parts) {
    if (!GSC_WORDS.test(sent) || gscClaimVerified(sent, brief)) { out.push(sent); continue }
    // Rettes kun ved entydigt match: præcis ét søgeord, ingen henvisning til forrige periode og ingen anden URL/periode i sætningen.
    const sa = brief && brief.gate.allowPerformanceBased ? standaloneKeywords(sent, brief) : []
    const kw = sa.length === 1 && sa[0].current && !PREV_CUE.test(sent) ? sa[0] : undefined
    if (kw) { out.push(`${fmtSlot(kw)}.`); changed++ } else removed++
  }
  const joined = out.map(x => x.trim().replace(/\.$/, '')).filter(Boolean).join('. ')
  return { text: joined ? joined + '.' : '', changed, removed }
}

// Server-side håndhævelse på Claudes svar:
//  - Udokumenterede GSC-påstande nedgraderes til hypotese og mærkes – de bruges aldrig som dokumentation, men forslaget bevares.
//  - Kun forslag, hvis eneste begrundelse er en mekanisk score, udelades ved velfungerende sider. Dokumenterede fejl, forkerte
//    produktdata, manglende oplysninger og intention/konvertering kan altid give OPTIMÉR.
export function applyBriefGate<T extends { evidence: string; source: string; observation: string; judgement?: string; element: string }>(
  data: { behold: boolean; beholdReason: string; suggestions: T[]; warnings: string[] },
  brief?: Brief | { gate?: Brief['gate'] },
): { behold: boolean; beholdReason: string; suggestions: T[]; warnings: string[] } {
  const gate = (brief as any)?.gate as Brief['gate'] | undefined
  if (!gate) return data
  const full = (brief as Brief).keywords ? (brief as Brief) : undefined
  const warnings = [...data.warnings]
  let corrected = 0, omitted = 0
  let sug = data.suggestions.map(sg => {
    const o = fixGscClaims(sg.observation, full), j = fixGscClaims(sg.judgement ?? '', full), src = fixGscClaims(sg.source, full)
    const ch = o.changed + j.changed + src.changed, rm = o.removed + j.removed + src.removed
    if (ch + rm === 0) return sg
    corrected += ch; omitted += rm
    const observation = o.text
    // «dokumenteret» kræver en tilbageværende observation; ellers bliver forslaget en redaktionel/hypotese-vurdering
    const evidence = sg.evidence === 'dokumenteret' && !observation.trim() ? 'redaktionel' : sg.evidence
    return { ...sg, observation, evidence, ...(sg.judgement !== undefined ? { judgement: j.text, reason: j.text } : {}), source: src.text || (full?.gate.allowPerformanceBased ? 'sidens tekst' : 'sidens tekst') }
  })
  if (corrected + omitted > 0) warnings.push(`Forkerte eller uverificerede GSC-tal i forslagene er ${corrected ? `rettet til dashboardets verificerede tal (${corrected})` : ''}${corrected && omitted ? ' og ' : ''}${omitted ? `udeladt (${omitted})` : ''}. Forslagene er bevaret.`)
  if (gate.recommendBehold) {
    const scoreOnly = (s: T) => s.evidence !== 'dokumenteret' && /\b(score|point|on-page-score)\b/i.test(`${s.source} ${s.observation} ${s.judgement ?? ''}`) && !/(fejl|forkert|mangler|manglende|uoverensstemmelse|intention|konvertering|bestil|specifikation)/i.test(`${s.observation} ${s.judgement ?? ''}`)
    const before = sug.length
    sug = sug.filter(s => !scoreOnly(s))
    if (sug.length < before) warnings.push(`${before - sug.length} forslag er udeladt: de begrundes kun med en on-page-score, og siden performer godt.`)
  }
  if (sug.length === 0) return { behold: true, beholdReason: gate.recommendBehold ? (gate.reason || 'Siden performer godt – behold eksisterende indhold.') : (data.beholdReason || 'Ingen fagligt begrundede ændringer.'), suggestions: [], warnings }
  return { behold: false, beholdReason: '', suggestions: sug, warnings }
}
