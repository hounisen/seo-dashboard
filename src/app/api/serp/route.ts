import { NextRequest, NextResponse } from 'next/server'

// Ahrefs API v3 – SERP Overview. Kaldes kun manuelt (knappen "Analysér SERP").
// Cache pr. serverinstans i 24 timer for at undgå unødvendige API-enheder.
const CACHE = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const { keyword, country = 'DK', refresh = false } = await req.json()
  if (!keyword || typeof keyword !== 'string') return NextResponse.json({ error: 'Søgeord mangler' }, { status: 400 })
  const apiKey = process.env.AHREFS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AHREFS_API_KEY er ikke sat i Vercel (Settings → Environment Variables).' }, { status: 500 })

  const key = `${country.toUpperCase()}|${keyword.trim().toLowerCase()}`
  const hit = CACHE.get(key)
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ...(hit.data as object), cached: true })
  }

  const params = new URLSearchParams({
    select: 'position,title,url,page_type,type,update_date,domain_rating,traffic',
    keyword: keyword.trim(),
    country: country.toLowerCase(),
    top_positions: '10',
    output: 'json',
  })
  try {
    const res = await fetch(`https://api.ahrefs.com/v3/serp-overview/serp-overview?${params.toString()}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* ikke JSON */ }
    if (!res.ok) {
      const msg = String((json && (json.error || json.message)) || text.slice(0, 200) || `HTTP ${res.status}`).slice(0, 180)
      // Skeln mellem utilgængelige data (adgang/plan/kvote) og API-fejl (ugyldigt kald, serverfejl)
      const unavailable = [401, 402, 403, 404, 429].includes(res.status)
      const hint = res.status === 401 || res.status === 403 ? ' Tjek at API-nøglen er gyldig og har adgang til SERP Overview.' : res.status === 429 ? ' For mange kald – prøv igen om lidt.' : ''
      const label = unavailable ? 'SERP-data er utilgængelige' : 'API-fejl'
      return NextResponse.json({ error: `${label} (Ahrefs ${res.status}): ${msg}.${hint}`, kind: unavailable ? 'utilgaengelig' : 'fejl' }, { status: 502 })
    }
    const positions = (json?.positions ?? []).map((p: any) => ({
      position: p.position,
      title: p.title ?? null,
      url: p.url ?? null,
      pageType: p.page_type ?? null,
      types: Array.isArray(p.type) ? p.type : [],
      updateDate: p.update_date ?? '',
      domainRating: p.domain_rating ?? null,
      traffic: p.traffic ?? null,
    }))
    const data = { keyword: keyword.trim(), country: country.toUpperCase(), fetchedAt: new Date().toISOString(), source: 'ahrefs' as const, positions }
    CACHE.set(key, { at: Date.now(), data })
    return NextResponse.json({ ...data, cached: false })
  } catch {
    return NextResponse.json({ error: 'Netværksfejl: kunne ikke nå Ahrefs. Prøv igen. Resten af analysen er upåvirket.', kind: 'fejl' }, { status: 502 })
  }
}
