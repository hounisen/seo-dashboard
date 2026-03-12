import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'URL mangler' }, { status: 400 })

  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'FIRECRAWL_API_KEY er ikke sat' }, { status: 500 })

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown', 'extract'], extract: { schema: { title: 'string', description: 'string', h1: 'string' } } }),
    })
    const data = await response.json()
    if (!response.ok) return NextResponse.json({ error: data.error ?? 'Firecrawl fejl' }, { status: 500 })

    return NextResponse.json({
      title: data.metadata?.title ?? data.extract?.title ?? '',
      description: data.metadata?.description ?? data.extract?.description ?? '',
      h1: data.extract?.h1 ?? '',
      bodyContent: data.markdown ?? '',
    })
  } catch (e) {
    return NextResponse.json({ error: 'Netværksfejl' }, { status: 500 })
  }
}
