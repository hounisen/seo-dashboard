import { NextRequest, NextResponse } from 'next/server'

function cleanMetaDescription(raw: string): string {
  if (!raw) return ''
  const commaInject = raw.match(/^(.{60,}?[.!?])\s*,\s*[A-ZÆØÅ]/)
  if (commaInject) return commaInject[1].trim()
  const semiInject = raw.match(/^(.{60,}?[.!?])\s*;\s*[A-ZÆØÅ]/)
  if (semiInject) return semiInject[1].trim()
  if (raw.length > 160) {
    const cutzone = raw.substring(0, 165)
    const lastEnd = Math.max(cutzone.lastIndexOf('. '), cutzone.lastIndexOf('! '), cutzone.lastIndexOf('? '), cutzone.lastIndexOf('.'))
    if (lastEnd > 60) return raw.substring(0, lastEnd + 1).trim()
    return raw.substring(0, 160).trim()
  }
  return raw.trim()
}

function cleanMarkdown(md: string): string {
  const lines = md.split('\n')
  const cleaned: string[] = []
  let skipBlock = false
  let skipUntilNextHeading = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim()
    if (/^\[hoteloasia\]|^\[View Instagram|instagram\.com\/p\/|instagram\.com\/reel\//.test(t)) skipBlock = true
    if (skipBlock) { if (/^#{1,3}\s/.test(t) && !/instagram|hoteloasia/i.test(t)) skipBlock = false; else continue }
    if (/bliv en del af|tilmeld.*nyhedsbrev|få nyheder.*eksklusive/i.test(t)) skipUntilNextHeading = true
    if (skipUntilNextHeading) { if (/^#{1,3}\s/.test(t)) skipUntilNextHeading = false; else continue }
    if (/^-\s+\[.+?\]\(https?:\/\/.+?\)$/.test(t)) continue
    if (/^-\s+[^\[].{1,60}$/.test(t) && !/[.,:;!?]/.test(t) && i < 10) continue
    if (t.startsWith('![') || t.startsWith('[![')) continue
    if (/GetImage\.ashx|\/Files\/Images\/Ecom\//.test(t)) continue
    if (/^\*\*(Varenummer|Varenavn|Måleområde|Lagerstatus|Bestillingsnummer|Art\.?nr):\*\*/i.test(t)) continue
    if (/^(På lager|Ikke på lager|Udgået|Kan bestilles)$/i.test(t)) continue
    if (/^(Vis alle|Vis kun|Sortering|Alfabetisk|Varenummer|Popularitet|Brand[A-Z])/i.test(t)) continue
    if (/\d+\s+produkter?\s+i\s+kategorien/i.test(t)) continue
    if (/^\[(Se produkt|Tilføj til kurv|Køb nu|Log ind|Bliv kunde|Opret)\]/i.test(t)) continue
    if (/for at se priser og købe/i.test(t)) continue
    if (/^\[Log ind\].*\[Bliv kunde\]/i.test(t)) continue
    if (/^Tlf\.?\s*[\d\s()+-]{6,}$/.test(t)) continue
    if (/^\[.*@.*\]\(mailto:/.test(t)) continue
    if (/^[✓✔●•▸]\s/.test(t) && t.length < 80 && !/[.,:;]$/.test(t)) continue
    if (/^(Dansk support|Dag-til-dag levering|Hurtig genbestilling|Faguddannet personale|Fragtfri|Gratis fragt)(\s*\(.*\))?$/i.test(t)) continue
    if (/^\[(Forrige|Næste|Scroll to top|Previous Slide|Next Slide)/i.test(t)) continue
    if (/^\[(Facebook|Twitter|Linkedin|Pinterest|Email|Instagram|Share|Open post|Scroll)/.test(t)) continue
    if (/^https?:\/\/\S+$/.test(t)) continue
    if (/Hide photo|Add ID to|Hide Specific Photos/.test(t)) continue
    if (/^\|[\s]*\|$/.test(t) || /^\|[\s]*####\s*\[/.test(t) || /^\|[\s]*---[\s]*\|$/.test(t)) continue
    if (/^[-|\s]+$/.test(t) && t.length > 0) continue
    if (/^@[a-zA-Z0-9_]+$/.test(t)) continue
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/.test(t)) continue
    if (/scontent-cph|cdninstagram\.com/.test(t)) continue
    if (/persondatapolitik|handelsbetingelser|privatlivspolitik|cookiepolitik/i.test(t) && t.length < 150) continue
    cleaned.push(line)
  }
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL mangler' }, { status: 400 })
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'FIRECRAWL_API_KEY er ikke sat' }, { status: 500 })
  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, maxAge: 0 }),
    })
    const data = await response.json()
    if (!response.ok) return NextResponse.json({ error: data.error ?? 'Firecrawl fejl' }, { status: 500 })
    const rawMarkdown = data.data?.markdown ?? data.markdown ?? ''
    const h1Match = rawMarkdown.match(/^#\s+(.+)$/m)
    const h1 = h1Match ? h1Match[1].trim() : ''
    const bodyContent = cleanMarkdown(rawMarkdown)
    const rawDescription = data.data?.metadata?.description ?? data.metadata?.description ?? ''
    const description = cleanMetaDescription(rawDescription)
    return NextResponse.json({ title: data.data?.metadata?.title ?? data.metadata?.title ?? '', description, h1, bodyContent })
  } catch {
    return NextResponse.json({ error: 'Netværksfejl – tjek din forbindelse' }, { status: 500 })
  }
}
