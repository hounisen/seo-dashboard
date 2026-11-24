import { NextRequest, NextResponse } from 'next/server'
import { applyBriefGate } from '@/lib/suggestBrief'
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
- Foreslå aldrig en ændring alene for at opnå højere score. Mindre afvigelser fra anbefalet tegnlængde (kind='laengde' i verdicts, eller title/meta inden for få tegn af intervallet) er ikke et dokumenteret problem: svar behold, medmindre teksten har en reel indholds- eller relevansmangel. Skeln mellem dokumenterede problemer, redaktionelle forbedringsmuligheder og små længdeafvigelser.
- Ved informativ eller blandet søgeintention må du ikke konkludere, at søgeordet hører til en anden side, og aldrig foreslå nye kategori- eller vidensider uden konkret evidens i inputtet (fx en navngiven eksisterende URL i SERP). Vurdér i stedet, om denne side kan dække en del af behovet.
- Input kan indeholde overlap (URL-overlap/mulig kannibalisering fra GSC og Ahrefs). Brug det kun som kontekst: overlap mellem produktvarianter (legitimt) kræver ingen handling, og 'utilstraekkeligt'/'begraenset' er ikke et problem. Konkludér aldrig kannibalisering, og foreslå aldrig sammenlægning, canonical eller redirect ud fra fælles søgeord. Hvis overlap er 'uhensigtsmaessigt' eller 'mulig-kannibalisering', må du kun foreslå at tydeliggøre sidens egen intention/produktmatch (fx title/H1/intro) eller et relevant internt link, markeret som 'hypotese' – og nævne usikkerheden.
- Input kan indeholde performance (GSC): current er den aktuelle periode, previous sammenligningsperioden. Brug kun current som aktuelle tal og nævn altid periode og kilde. Hvis performance.status er 'valideringsfejl', brug ingen GSC-tal. Præsentér aldrig teoretiske klikestimater som dokumenteret potentiale, og nævn at summer fra GSC-eksporter ikke er validerede totaler.
- Input starter med «brief»: et beslutningsgrundlag beregnet af dashboardet. Følg det:
  1) Læs først udviklingen (brief.summary og brief.keywords[].trend: aktuel periode vs. sammenligningsperiode). Fremhæv væsentlig fremgang og tilbagegang i observation, og nævn periode og kilde (GSC, Ahrefs, SERP) i source.
  2) Hvis brief.gate.allowPerformanceBased er false, må ingen forslag bygge på GSC-tal. Brug kun den aktuelle periode som aktuelle tal – aldrig sammenligningsperioden.
  3) Hvis brief.gate.recommendBehold er true, taler performance for at bevare indholdet – men det blokerer ikke forbedringer. Du kan stadig give forslag (OPTIMÉR) ved faktuelle fejl, forkerte produktdata, manglende oplysninger i produktteksten eller reelle problemer med søgeintention eller konvertering, når de kan påvises i sidens tekst eller input. Omskriv ikke velfungerende indhold, og foreslå aldrig ændringer alene for at hæve en on-page-score.
  4) Prioritér efter forretningsrelevans og dokumenteret mulighed – ikke kun eksponeringer og placering: søgeintention (SERP), produktspecifikationer på siden, B2B-målgruppe og sidens konverteringsformål. keywords[].relevance og action styrer prioriteringen; action 'hypotese-mulighed' er altid en hypotese, 'afvent-data' giver intet forslag.
  5) Ved action 'undersoeg-overlap' (flere Hounisen-URL'er har aktuel synlighed): foreslå ikke ændringer på denne side på det søgeord; beskriv i stedet, hvad der bør undersøges (hvilken side opfylder intentionen bedst), som 'hypotese'.
  6) CTR og placering er observationer; forventet CTR (ctrNote) er en hypotese baseret på en generisk benchmarkkurve. Angiv aldrig estimerede ekstra klik eller trafik som dokumenteret mulighed.
  7) Foreslå ikke nye afsnit eller tekst om emner, som siden allerede dækker tilstrækkeligt (keywords[].coverage 'dækket', eller fremgår af current.body).
  8) Højst tre forslag, hvert med element, current, proposed, placement, observation (fakta + periode), judgement og source. Er ingen ændring fagligt begrundet, svar behold=true.
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
      const gated = applyBriefGate(outcome.data, body?.brief)
      debug.briefGate = body?.brief?.gate ? { allowPerformanceBased: body.brief.gate.allowPerformanceBased, recommendBehold: body.brief.gate.recommendBehold } : undefined
      return NextResponse.json({ ok: true, ...gated, model, generatedAt: new Date().toISOString(), debug })
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
