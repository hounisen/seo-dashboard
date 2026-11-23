import { NextRequest, NextResponse } from 'next/server'

// Genererer konkrete tekstforslag med Claude. Kaldes kun manuelt (knappen "Generér forslag").
// Forslag er kun forslag: de overskriver aldrig indhold, og brugeren anvender, redigerer eller afviser hver for sig.

const SYSTEM = `Du er en erfaren dansk SEO-redaktør, der giver konkrete, ærlige tekstforslag til en webside.
Regler:
- Svar KUN med gyldig JSON uden markdown.
- Foreslå højst 3 væsentlige forbedringer, prioriteret efter dokumenteret effekt. Hvis eksisterende indhold fungerer, svar behold=true med kort begrundelse og ingen forslag.
- Opfind ALDRIG produktegenskaber, certificeringer, priser, leveringsløfter eller sortiment, som ikke fremgår af den givne forretningskontekst eller sidens eksisterende tekst.
- Foreslå kun søgeord/emner, der matcher sidens formål, målgruppe og faktiske sortiment.
- Hvert forslag skal have: element (title|meta|h1|h2|intro|body|link), current (eksisterende tekst, tom hvis nyt), proposed (færdigformuleret tekst), reason (kort, konkret), evidence (dokumenteret|hypotese|redaktionel), source (hvilke data understøtter det: fx "SERP", "GSC", "Ahrefs", "forretningskontekst", "sidens tekst"), placement (kun for h2/intro/body/link: præcis hvor, fx "efter overskriften 'X'" eller "som sidste afsnit").
- "dokumenteret" kræver konkrete data i inputtet. Ellers brug "hypotese" eller "redaktionel".
- title ≈ 30–65 tegn, meta ≈ 120–160 tegn. Skriv naturligt dansk til B2B-målgruppen, ingen overdrivelser.
Format: {"behold":boolean,"beholdReason":string,"suggestions":[{"element":...,"current":...,"proposed":...,"reason":...,"evidence":...,"source":...,"placement":...}]}`

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY er ikke sat i Vercel (Settings → Environment Variables).' }, { status: 500 })
  const body = await req.json()
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
  const user = `Her er data om siden (JSON). Giv forslag efter reglerne.\n\n${JSON.stringify(body).slice(0, 24000)}`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: user }] }),
    })
    const json: any = await res.json()
    if (!res.ok) return NextResponse.json({ error: `Claude API-fejl (${res.status}): ${json?.error?.message ?? 'ukendt fejl'}` }, { status: 502 })
    const text: string = (json.content ?? []).map((c: any) => c.text ?? '').join('')
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    let parsed: any
    try { parsed = JSON.parse(cleaned) } catch {
      return NextResponse.json({ error: 'Svaret kunne ikke læses som forslag. Prøv igen.' }, { status: 502 })
    }
    const allowed = ['title', 'meta', 'h1', 'h2', 'intro', 'body', 'link']
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((s: any) => s && allowed.includes(s.element) && typeof s.proposed === 'string' && s.proposed.trim())
      .slice(0, 5)
      .map((s: any) => ({
        element: s.element,
        current: typeof s.current === 'string' ? s.current : '',
        proposed: s.proposed,
        reason: typeof s.reason === 'string' ? s.reason : '',
        evidence: ['dokumenteret', 'hypotese', 'redaktionel'].includes(s.evidence) ? s.evidence : 'redaktionel',
        source: typeof s.source === 'string' ? s.source : '',
        placement: typeof s.placement === 'string' ? s.placement : '',
      }))
    return NextResponse.json({
      behold: !!parsed.behold && suggestions.length === 0,
      beholdReason: typeof parsed.beholdReason === 'string' ? parsed.beholdReason : '',
      suggestions,
      model,
      generatedAt: new Date().toISOString(),
    })
  } catch {
    return NextResponse.json({ error: 'Kunne ikke nå Claude API. Resten af analysen er upåvirket.' }, { status: 502 })
  }
}
