import { NextRequest, NextResponse } from 'next/server'

// ── Meta description cleaner ────────────────────────────────────────────────
// Removes injected third-party content (e.g. Opally, ad scripts) that some
// platforms append to the meta description after a comma or semicolon.
function cleanMetaDescription(raw: string): string {
  if (!raw) return ''

  // Pattern 1: ", SomeThirdParty..." – comma followed by capital letter after min 60 chars
  // Catches: "Real meta., Opally's AI skriver..." or "Real meta, ThirdParty..."
  const commaInject = raw.match(/^(.{60,}?[.!?])\s*,\s*[A-ZÆØÅ]/)
  if (commaInject) return commaInject[1].trim()

  // Pattern 2: semicolon injection after min 60 chars
  const semiInject = raw.match(/^(.{60,}?[.!?])\s*;\s*[A-ZÆØÅ]/)
  if (semiInject) return semiInject[1].trim()

  // Pattern 3: over 160 chars – cut at last sentence boundary before 160
  if (raw.length > 160) {
    const cutzone = raw.substring(0, 165)
    const lastEnd = Math.max(
      cutzone.lastIndexOf('. '),
      cutzone.lastIndexOf('! '),
      cutzone.lastIndexOf('? '),
      cutzone.lastIndexOf('.')
    )
    if (lastEnd > 60) return raw.substring(0, lastEnd + 1).trim()
    return raw.substring(0, 160).trim()
  }

  return raw.trim()
}

// ── Markdown cleaner ─────────────────────────────────────────────────────────
// Removes social media embeds, e-commerce UI, navigation cruft and other
// non-content blocks that Firecrawl picks up from widgets and sidebars.
function cleanMarkdown(md: string): string {
  const lines = md.split('\n')
  const cleaned: string[] = []
  let skipBlock = false
  let skipUntilNextHeading = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    // ── Skip entire Instagram / social embed blocks ──────────────────────────
    if (/^\[hoteloasia\]|^\[View Instagram|instagram\.com\/p\/|instagram\.com\/reel\//.test(t)) {
      skipBlock = true
    }
    if (skipBlock) {
      if (/^#{1,3}\s/.test(t) && !/instagram|hoteloasia/i.test(t)) skipBlock = false
      else continue
    }

    // ── Skip newsletter/signup sections (trigger phrase → next heading) ───────
    if (/bliv en del af|tilmeld.*nyhedsbrev|få nyheder.*eksklusive|sign up for our|subscribe to our/i.test(t)) {
      skipUntilNextHeading = true
    }
    if (skipUntilNextHeading) {
      if (/^#{1,3}\s/.test(t)) skipUntilNextHeading = false
      else continue
    }

    // ── Breadcrumb navigation ────────────────────────────────────────────────
    // "- [Label](url)" – single link list item = breadcrumb
    if (/^-\s+\[.+?\]\(https?:\/\/.+?\)$/.test(t)) continue
    // "- Plain text" that is clearly a breadcrumb tail (short, no sentence)
    if (/^-\s+[^[].{1,60}$/.test(t) && !/[.,:;!?]/.test(t) && i < 10) continue

    // ── Image lines ──────────────────────────────────────────────────────────
    if (t.startsWith('![') || t.startsWith('[![')) continue
    // GetImage CDN / product image URLs
    if (/GetImage\.ashx|\/Files\/Images\/Ecom\//.test(t)) continue

    // ── Product card / e-commerce UI ────────────────────────────────────────
    if (/^\*\*(Varenummer|Varenavn|Måleområde|Lagerstatus|Bestillingsnummer|Art\.?nr):\*\*/i.test(t)) continue
    if (/^(På lager|Ikke på lager|Udgået|Kan bestilles|In stock|Out of stock)$/i.test(t)) continue
    if (/^(Vis alle|Vis kun|Sortering|Alfabetisk|Varenummer|Popularitet|Brand[A-Z])/i.test(t)) continue
    if (/\d+\s+produkter?\s+i\s+kategorien/i.test(t)) continue
    // CTA buttons
    if (/^\[(Se produkt|Tilføj til kurv|Køb nu|Log ind|Bliv kunde|Opret|Add to cart)\]/i.test(t)) continue
    if (/for at se priser og købe/i.test(t)) continue
    // "Log ind" or "Bliv kunde" embedded in line
    if (/^\[Log ind\].*\[Bliv kunde\]/i.test(t)) continue

    // ── Contact / USP lines ──────────────────────────────────────────────────
    if (/^Tlf\.?\s*[\d\s()+-]{6,}$/.test(t)) continue
    if (/^\[.*@.*\]\(mailto:/.test(t)) continue
    // ✓ checkmark USP lines (short, no sentence-ending punctuation)
    if (/^[✓✔●•▸]\s/.test(t) && t.length < 80 && !/[.,:;]$/.test(t)) continue
    // Standalone USP words repeated outside content area
    if (/^(Dansk support|Dag-til-dag levering|Hurtig genbestilling|Faguddannet personale|Fragtfri|Gratis fragt)(\s*\(.*\))?$/i.test(t)) continue

    // ── Navigation / pagination ──────────────────────────────────────────────
    if (/^\[(Forrige|Næste|Scroll to top|Previous Slide|Next Slide)/i.test(t)) continue

    // ── Social sharing ───────────────────────────────────────────────────────
    if (/^\[(Facebook|Twitter|Linkedin|Pinterest|Email|Instagram|Share|Open post|Scroll)/.test(t)) continue

    // ── Bare URLs ────────────────────────────────────────────────────────────
    if (/^https?:\/\/\S+$/.test(t)) continue

    // ── CMS / admin noise ────────────────────────────────────────────────────
    if (/Hide photo|Add ID to|Hide Specific Photos/.test(t)) continue

    // ── Table spacers ────────────────────────────────────────────────────────
    if (/^\|[\s]*\|$/.test(t)) continue
    if (/^\|[\s]*####\s*\[/.test(t)) continue
    if (/^\|[\s]*---[\s]*\|$/.test(t)) continue
    if (/^[-|\s]+$/.test(t) && t.length > 0) continue

    // ── Instagram metadata ───────────────────────────────────────────────────
    if (/^@[a-zA-Z0-9_]+$/.test(t)) continue
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/.test(t)) continue
    if (/scontent-cph|cdninstagram\.com/.test(t)) continue

    // ── GDPR boilerplate (short lines only) ──────────────────────────────────
    if (/persondatapolitik|handelsbetingelser|privatlivspolitik|cookiepolitik/i.test(t) && t.length < 150) continue

    cleaned.push(line)
  }

  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}



export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL mangler' }, { status: 400 })

  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'FIRECRAWL_API_KEY er ikke sat' }, { status: 500 })

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        maxAge: 0,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json({ error: data.error ?? 'Firecrawl fejl' }, { status: 500 })
    }

    // Extract H1 from markdown (first # heading)
    const rawMarkdown = data.data?.markdown ?? data.markdown ?? ''
    const h1Match = rawMarkdown.match(/^#\s+(.+)$/m)
    const h1 = h1Match ? h1Match[1].trim() : ''

    // Clean markdown – strip social widgets, e-commerce UI, nav noise
    const bodyContent = cleanMarkdown(rawMarkdown)

    const rawDescription = data.data?.metadata?.description ?? data.metadata?.description ?? ''
    const description = cleanMetaDescription(rawDescription)

    return NextResponse.json({
      title: data.data?.metadata?.title ?? data.metadata?.title ?? '',
      description,
      h1,
      bodyContent,
    })
  } catch {
    return NextResponse.json({ error: 'Netværksfejl – tjek din forbindelse' }, { status: 500 })
  }
}
