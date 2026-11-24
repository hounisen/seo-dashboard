import { NextRequest, NextResponse } from 'next/server'
import { SUGGEST_SCHEMA, parseSuggestionText, scrub } from '@/lib/suggestParse'

// Genererer konkrete tekstforslag med Claude. Kaldes kun manuelt (knappen "Generér forslag").
// Forslag er kun forslag: de overskriver aldrig indhold, og brugeren anvender, redigerer eller afviser hver for sig.

const SYSTEM = `Du er en erfaren dansk SEO-redaktør, der giver konkrete, ærlige tekstforslag til en webside.
Regler:
- Svar KUN med gyldig JSON uden markdown eller indledende tekst.
- Hold felterne korte (observation/judgement højst 2 sætninger, body-forslag højst ca. 120 ord), så svaret ikke afkortes.
- Hvis søgeordet ikke er godkendt (keywordApproved=false), giv stadig foreløbige forslag – marker dem som 'hypotese' eller 'redaktionel'.
- Foreslå højst 3 væsentlige forbedringer, prioriteret efter dokumenteret effekt. Hvis eksisterende indhold fungerer, svar behold=true med kort begrundelse og ingen forslag.
- Opfind ALDRIG produktegenskaber, certificeringer, priser, leveringsløfter eller sortiment, som ikke fremgår af den givne forretningskontekst eller sidens eksisterende tekst.
- Input indeholder analysisMode ('ny' = SEO-planlægning, 'eksisterende' = optimering) og keywordAssessments med B2B-vurdering og rolle pr. søgeord. Brug kun søgeord med role 'primaer' eller 'sekundaer' i title/meta/H1/brødtekst. Søgeord med role 'fravaelg' eller 'anden-side' må IKKE indarbejdes på siden; nævn i stedet i beholdReason eller reason, at de bør målrettes en anden side. Basis 'estimat' er ikke verificeret: marker forslag som 'hypotese'. Ved analysisMode 'ny' må GSC ikke bruges som dokumentation for sidens performance.
- Foreslå kun søgeord/emner, der matcher sidens formål, målgruppe og faktiske sortiment.
- Hvert forslag skal have: element (title|meta|h1|h2|intro|body|link), current (eksisterende tekst, tom hvis nyt), proposed (færdigformuleret tekst), observation (KUN målbare fakta fra inputtet, fx tegnantal eller at et ord mangler – tom hvis der ingen er), judgement (din faglige vurdering af, hvorfor ændringen hjælper – kort), evidence (dokumenteret|hypotese|redaktionel), source (hvilke data understøtter det: fx "SERP", "GSC", "Ahrefs", "forretningskontekst", "sidens tekst"), placement (kun for h2/intro/body/link: præcis hvor, fx "efter overskriften 'X'" eller "som sidste afsnit").
- Skeln strengt mellem observation (dokumenteret i inputtet) og judgement (faglig vurdering). Antal interne links, ordantal eller tilstedeværelse af et element er IKKE dokumentation for kvalitet eller relevans. Linkforslag er altid "hypotese", da destinationerne ikke er undersøgt i inputtet.
- "dokumenteret" kræver konkrete data i inputtet (observation udfyldt). Ellers brug "hypotese" eller "redaktionel".
- title ≈ 30–65 tegn, meta ≈ 120–160 tegn. Skriv naturligt dansk til B2B-målgruppen, ingen overdrivelser.
Format: {"behold":boolean,"beholdReason":string,"suggestions":[{"element":...,"current":...,"proposed":...,"observation":...,"judgement":...,"evidence":...,"source":...,"placement":...}]}`


const BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
const STRUCTURED_VERSION = process.env.ANTHROPIC_VERSION_STRUCTURED || '2026-10-21'
const MAX_TOKENS = 4096

function apiProblem(status: number, type: string | undefined, message: string) {
  const msg = scrub(message).slice(0, 300)
  if (status === 401 || status === 403) return { kind: 'konfiguration', error: `Konfigurationsfejl: Claude API afviste nøglen eller adgangen (${status}). ${msg}` }
  if (status === 429) return { kind: 'api', error: `Claude API-fejl (429, for mange kald): prøv igen om lidt. ${msg}` }
  if (status >= 500 || status === 529) return { kind: 'api', error: `Claude API-fejl (${status}, midlertidig fejl hos Anthropic): prøv igen om lidt. ${msg}` }
  return { kind: 'api', error: `Claude API-fejl (${status}${type ? `, ${type}` : ''}): ${msg}` }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ ok: false, kind: 'konfiguration', error: 'Konfigurationsfejl: ANTHROPIC_API_KEY er ikke sat i Vercel (Settings → Environment Variables).' }, { status: 500 })
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, kind: 'api', error: 'Ugyldig forespørgsel fra dashboardet.' }, { status: 400 }) }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
  const user = `Her er data om siden (JSON). Giv forslag efter reglerne.\n\n${JSON.stringify(body).slice(0, 24000)}`
  const debug: Record<string, unknown> = { model }

  // Ét kald med struktureret output. Kun hvis API'et afviser selve forespørgselsformatet (400, ikke faktureret),
  // sendes samme forespørgsel én gang uden schema. Øvrige fejl gentages aldrig automatisk.
  async function call(structured: boolean) {
    const payload: Record<string, unknown> = { model, max_tokens: MAX_TOKENS, system: SYSTEM, messages: [{ role: 'user', content: user }] }
    if (structured) payload.output_config = { format: { type: 'json_schema', schema: SUGGEST_SCHEMA } }
    const res = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey as string, 'anthropic-version': structured ? STRUCTURED_VERSION : '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const raw = await res.text()
    let json: any = null
    try { json = JSON.parse(raw) } catch { /* ikke JSON */ }
    return { res, json, raw }
  }

  try {
    let attempt = 1
    let r = await call(true)
    debug.mode = 'structured'
    if (r.res.status === 400 && /output_config|output_format|json_schema|schema|structured/i.test(r.json?.error?.message ?? r.raw)) {
      attempt = 2
      debug.structuredRejected = scrub(r.json?.error?.message ?? r.raw).slice(0, 200)
      r = await call(false)
      debug.mode = 'prompt-json'
    }
    debug.attempt = attempt
    debug.status = r.res.status
    debug.requestId = r.res.headers.get('request-id') ?? undefined
    if (!r.res.ok) {
      const p = apiProblem(r.res.status, r.json?.error?.type, r.json?.error?.message ?? r.raw.slice(0, 200))
      debug.apiErrorType = r.json?.error?.type
      return NextResponse.json({ ok: false, ...p, debug }, { status: 502 })
    }
    const json = r.json
    debug.stopReason = json?.stop_reason ?? null
    debug.usage = json?.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : undefined
    const text: string = (json?.content ?? []).filter((c: any) => c?.type === 'text' || c?.text).map((c: any) => c.text ?? '').join('')
    const outcome = parseSuggestionText(text, json?.stop_reason)
    if (outcome.ok) {
      return NextResponse.json({ ok: true, ...outcome.data, model, generatedAt: new Date().toISOString(), debug })
    }
    debug.problem = outcome.kind
    // Tomt eller afvist svar: ingen tekst at vise. Læsbart svar, der ikke kan fortolkes: vises som foreløbigt tekstsvar.
    if (outcome.kind === 'tomt' || outcome.kind === 'afvist') {
      return NextResponse.json({ ok: false, kind: outcome.kind, error: `${outcome.kind === 'tomt' ? 'Tomt svar' : 'Svar afvist'}: ${outcome.message}`, debug }, { status: 502 })
    }
    return NextResponse.json({ ok: false, textOnly: true, kind: outcome.kind, message: outcome.message, text: scrub(text).slice(0, 8000), model, generatedAt: new Date().toISOString(), debug })
  } catch (e: any) {
    debug.exception = scrub(String(e?.message ?? e)).slice(0, 200)
    return NextResponse.json({ ok: false, kind: 'netvaerk', error: 'Netværksfejl: kunne ikke nå Claude API. Resten af analysen er upåvirket.', debug }, { status: 502 })
  }
}
