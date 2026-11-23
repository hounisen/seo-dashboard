import { NextRequest, NextResponse } from 'next/server'
import { cleanMarkdown, cleanMetaDescription } from '@/lib/cleanContent'

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
