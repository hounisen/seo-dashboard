import { NextRequest, NextResponse } from 'next/server'

// ── Markdown cleaner ─────────────────────────────────────────────────────────
// Removes social media embeds, navigation cruft, image noise and other
// non-content blocks that Firecrawl picks up from widgets and sidebars.
function cleanMarkdown(md: string): string {
  const lines = md.split('\n')
  const cleaned: string[] = []
  let skipBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // ── Skip entire Instagram / social embed blocks ──────────────────────────
    // Starts when we see an Instagram username line or "View Instagram post"
    if (/^\[hoteloasia\]|^\[View Instagram|instagram\.com\/p\/|instagram\.com\/reel\//.test(trimmed)) {
      skipBlock = true
    }
    // End skip block at next real heading or after a blank line following junk
    if (skipBlock) {
      if (/^#{1,3}\s/.test(trimmed) && !/instagram|hoteloasia/i.test(trimmed)) {
        skipBlock = false
      } else {
        continue
      }
    }

    // ── Drop individual noisy line patterns ──────────────────────────────────

    // Navigation links: [ForrigeForrige...], [NæsteNæste...], [Scroll to top...]
    if (/^\[(Forrige|Næste|Scroll to top|Previous Slide|Next Slide)/i.test(trimmed)) continue

    // Image-only markdown lines: [![alt text](url)](url) or ![alt](url)
    if (/^!\[/.test(trimmed)) continue

    // Pure markdown link lines that are just UI elements (share, social, nav)
    if (/^\[(Facebook|Twitter|Linkedin|Pinterest|Email|Instagram|Share|Open post|Scroll)/.test(trimmed)) continue

    // Lines that are just a URL or empty anchor
    if (/^https?:\/\/\S+$/.test(trimmed)) continue

    // "Add ID to the Hide Specific Photos" and similar CMS admin notes
    if (/Hide photo|Add ID to|Hide Specific Photos/.test(trimmed)) continue

    // Single-cell table rows used as spacers/nav: |     | or | #### [text] |
    if (/^\|[\s]*\|$/.test(trimmed)) continue
    if (/^\|[\s]*####\s*\[/.test(trimmed)) continue
    if (/^\|[\s]*---[\s]*\|$/.test(trimmed)) continue

    // Lines that are only punctuation / markdown table separators
    if (/^[-|\s]+$/.test(trimmed) && trimmed.length > 0) continue

    // Drop lines with only an Instagram handle @mention
    if (/^@[a-zA-Z0-9_]+$/.test(trimmed)) continue

    // Drop "Mar DD" date stamps (Instagram post dates)
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$/.test(trimmed)) continue

    // Drop scontent CDN image URLs embedded in text
    if (/scontent-cph|cdninstagram\.com/.test(trimmed)) continue

    cleaned.push(line)
  }

  // Collapse 3+ consecutive blank lines into 2
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
        skipCache: true,
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

    // Clean markdown – strip social widgets, nav noise, image alt-text blocks
    const bodyContent = cleanMarkdown(rawMarkdown)

    return NextResponse.json({
      title: data.data?.metadata?.title ?? data.metadata?.title ?? '',
      description: data.data?.metadata?.description ?? data.metadata?.description ?? '',
      h1,
      bodyContent,
    })
  } catch {
    return NextResponse.json({ error: 'Netværksfejl – tjek din forbindelse' }, { status: 500 })
  }
}
