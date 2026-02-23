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
        formats: ['markdown', 'html'],
        onlyMainContent: false, // Get ALL content, we'll filter ourselves
        waitFor: 3000, // Wait 3 seconds for JavaScript to render
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
    const rawHtml: string = data.data?.rawHtml ?? ''

    // Debug info - check what formats Firecrawl actually returned
    const availableFormats = Object.keys(data.data || {})
    const debugInfo = {
      hasHtml: !!html,
      htmlLength: html.length,
      hasRawHtml: !!rawHtml,
      rawHtmlLength: rawHtml.length,
      formats: availableFormats,
    }

    // Try to find JSON-LD in either html or rawHtml
    const htmlToSearch = rawHtml || html
    const jsonLdMatches = htmlToSearch.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    let hasStructuredData = jsonLdMatches && jsonLdMatches.length > 0
    const structuredDataTypes: string[] = []
    
    if (jsonLdMatches) {
      jsonLdMatches.forEach((match, idx) => {
        try {
          const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim()
          const parsed = JSON.parse(jsonContent)
          const type = parsed['@type']
          if (type && !structuredDataTypes.includes(type)) {
            structuredDataTypes.push(type)
          }
        } catch (err) {
          // Invalid JSON-LD, skip
        }
      })
    }
    
    // Fallback: check if metadata has schema.org info
    if (!hasStructuredData && metadata.ogType) {
      // If we have OpenGraph but no JSON-LD detected, still mark as having *some* structured data
      // This prevents false negatives when Firecrawl strips script tags
      hasStructuredData = true
      structuredDataTypes.push('OpenGraph')
    }

    // Clean markdown: remove navigation, footer, social widgets but keep all main content
    let cleanedMarkdown = markdown
    
    // STEP 1: Remove everything BEFORE the main H1 heading (navigation, login modal, menu)
    const navigationEndMatch = cleanedMarkdown.match(/^# [A-ZÆØÅ]/m)
    if (navigationEndMatch && navigationEndMatch.index) {
      cleanedMarkdown = cleanedMarkdown.substring(navigationEndMatch.index)
    }
    
    // STEP 2: Remove everything AFTER newsletter signup (footer starts there)
    const footerStartMatch = cleanedMarkdown.match(/## Bliv en del af/m)
    if (footerStartMatch && footerStartMatch.index) {
      cleanedMarkdown = cleanedMarkdown.substring(0, footerStartMatch.index)
    }
    
    // STEP 3: Remove specific junk patterns
    const junkPatterns = [
      /Dansk support.*?Faguddannet personale/g, // USP boxes with icons
      /!\[\]\(https:\/\/www\..*?\)\s*\n\s*\n/g, // Empty image placeholders
    ]
    
    junkPatterns.forEach(pattern => {
      cleanedMarkdown = cleanedMarkdown.replace(pattern, '')
    })
    
    // Remove excessive newlines (more than 2 consecutive)
    cleanedMarkdown = cleanedMarkdown.replace(/\n{3,}/g, '\n\n').trim()

    // Count approximate word count from cleaned markdown
    const wordCount = cleanedMarkdown.split(/\s+/).filter(Boolean).length

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
      bodyContent: cleanedMarkdown,
      wordCount,
      internalLinks,
      h2Count,
      url: metadata.url ?? url,
      hasStructuredData,
      structuredDataTypes,
      _debug: debugInfo, // Temporary debug info
    })
  } catch (err) {
    console.error('Scrape error:', err)
    return NextResponse.json({ error: 'Ukendt fejl ved scraping' }, { status: 500 })
  }
}
