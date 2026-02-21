// app/api/scrape/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { url } = await req.json()

  if (!url) {
    return NextResponse.json({ error: 'URL er påkrævet' }, { status: 400 })
  }

  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'FIRECRAWL_API_KEY er ikke sat' }, { status: 500 })
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        excludeTags: ['script', 'style', 'nav', 'footer', 'iframe', 'noscript', 'aside', 'form'],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `Firecrawl fejl: ${err}` }, { status: response.status })
    }

    const data = await response.json()

    // Extract useful fields from the scraped page
    const markdown: string = data.data?.markdown ?? ''
    const metadata = data.data?.metadata ?? {}
    const html: string = data.data?.html ?? ''

    // Detect structured data (JSON-LD) in the HTML
    const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    const hasStructuredData = jsonLdMatches && jsonLdMatches.length > 0
    const structuredDataTypes: string[] = []
    
    if (jsonLdMatches) {
      jsonLdMatches.forEach(match => {
        try {
          const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim()
          const parsed = JSON.parse(jsonContent)
          const type = parsed['@type']
          if (type && !structuredDataTypes.includes(type)) {
            structuredDataTypes.push(type)
          }
        } catch {
          // Invalid JSON-LD, skip
        }
      })
    }

    // Count approximate word count from markdown
    const wordCount = markdown.split(/\s+/).filter(Boolean).length

    // Extract H1 from metadata or first # in markdown
    const h1Match = markdown.match(/^#\s+(.+)$/m)
    const h1 = h1Match?.[1] ?? metadata.title ?? ''

    // Count internal links (rough heuristic from markdown)
    const domain = new URL(url).hostname
    const internalLinkMatches = markdown.match(new RegExp(`\\[.*?\\]\\(https?://${domain.replace('.', '\\.')}`, 'g'))
    const internalLinks = internalLinkMatches?.length ?? 0

    // Count H2s
    const h2Matches = markdown.match(/^##\s+/gm)
    const h2Count = h2Matches?.length ?? 0

    // Fix meta description - only take first sentence if multiple are concatenated
    let description = metadata.description ?? ''
    if (description.includes(',')) {
      // Split by comma and take first part if it looks like multiple descriptions
      const parts = description.split(',')
      if (parts.length > 1 && parts[1].trim().length > 50) {
        description = parts[0].trim()
      }
    }

    return NextResponse.json({
      success: true,
      title: metadata.title ?? '',
      description,
      h1,
      bodyContent: markdown,
      wordCount,
      internalLinks,
      h2Count,
      url: metadata.url ?? url,
      hasStructuredData,
      structuredDataTypes,
    })
  } catch (err) {
    console.error('Scrape error:', err)
    return NextResponse.json({ error: 'Ukendt fejl ved scraping' }, { status: 500 })
  }
}
