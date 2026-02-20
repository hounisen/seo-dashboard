'use client'

import { useState, useCallback, useEffect } from 'react'
import { analyzeSeo, SeoInput, SeoResult, KeywordStatus } from '@/lib/seoEngine'

// ── Types ────────────────────────────────────────────────────────────────────
interface FormState {
  url: string
  competitorUrls: string
  targetKeyword: string
  semanticKeywords: string
  customKeywords: string
  pageTitle: string
  metaDescription: string
  h1: string
  bodyContent: string
}

interface GscData {
  keyword: string
  impressions: number
  clicks: number
  position: number
}

const DEFAULT_FORM: FormState = {
  url: '',
  competitorUrls: '',
  targetKeyword: '',
  semanticKeywords: '',
  customKeywords: '',
  pageTitle: '',
  metaDescription: '',
  h1: '',
  bodyContent: '',
}

// ── Helper components ─────────────────────────────────────────────────────────

function ScoreRing({ pct }: { pct: number }) {
  const r = 45
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  const color = pct >= 70 ? '#2dce89' : pct >= 45 ? '#ffb547' : '#ff4d6a'

  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="#e8eaf0" strokeWidth="8" />
      <circle
        cx="55" cy="55" r={r} fill="none"
        stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 55 55)"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s' }}
      />
      <text x="55" y="55" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Inter, sans-serif', fill: '#1a1a2e' }}>
        {pct}
      </text>
    </svg>
  )
}

function StatusPill({ status }: { status: 'ok' | 'warn' | 'error' }) {
  const map = {
    ok:    { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400', label: 'Optimised' },
    warn:  { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400',   label: 'Advarsel' },
    error: { bg: 'bg-red-50',     text: 'text-red-600',     dot: 'bg-red-400',     label: 'Fejl' },
  }
  const s = map[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-600 ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

function KwStatusTag({ status }: { status: KeywordStatus }) {
  const map = {
    God:     'bg-emerald-50 text-emerald-700',
    Optimer: 'bg-amber-50 text-amber-700',
    Mangler: 'bg-red-50 text-red-600',
  }
  const dots = {
    God:     'bg-emerald-400',
    Optimer: 'bg-amber-400',
    Mangler: 'bg-red-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {status}
    </span>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="relative h-4 rounded-full overflow-hidden" style={{
      background: 'linear-gradient(90deg, #ff4d6a 0%, #ff8c42 20%, #ffb547 40%, #a8d85e 60%, #2dce89 80%, #e0e4ea 80%)'
    }}>
      <div
        className="absolute top-[-5px] w-0 h-0 transition-all duration-1000 ease-out"
        style={{
          left: `${Math.min(pct * 0.8 + 1, 79)}%`,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: '10px solid #1a1a2e',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SeoDashboard() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [result, setResult] = useState<SeoResult | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState('')
  const [openRec, setOpenRec] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'form' | 'dashboard'>('form')
  const [gscData, setGscData] = useState<GscData[]>([])
  const [gscFileName, setGscFileName] = useState('')
  const [competitorAnalysis, setCompetitorAnalysis] = useState<{url: string, result: SeoResult} | null>(null)
  const [analyzingCompetitor, setAnalyzingCompetitor] = useState(false)

  // Live-recalculate whenever form changes
  useEffect(() => {
    if (!form.targetKeyword) { setResult(null); return }
    const input: SeoInput = {
      url: form.url,
      competitorUrls: form.competitorUrls.split('\n').map(s => s.trim()).filter(Boolean),
      targetKeyword: form.targetKeyword.trim(),
      semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
      pageTitle: form.pageTitle,
      metaDescription: form.metaDescription,
      h1: form.h1,
      bodyContent: form.bodyContent,
    }
    setResult(analyzeSeo(input))
  }, [form])

  const updateForm = useCallback((key: keyof FormState, val: string) => {
    setForm(prev => ({ ...prev, [key]: val }))
  }, [])

  // Scrape URL via API
  const handleScrape = useCallback(async () => {
    if (!form.url) return
    setScraping(true)
    setScrapeError('')
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setScrapeError(data.error ?? 'Scraping fejlede')
        return
      }
      setForm(prev => ({
        ...prev,
        pageTitle: data.title || prev.pageTitle,
        metaDescription: data.description || prev.metaDescription,
        h1: data.h1 || prev.h1,
        bodyContent: data.bodyContent || prev.bodyContent,
      }))
      setActiveTab('dashboard')
    } catch {
      setScrapeError('Netværksfejl – tjek din forbindelse')
    } finally {
      setScraping(false)
    }
  }, [form.url])

  // Handle GSC CSV upload
  const handleGscUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    setGscFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const lines = text.split('\n').filter(Boolean)
      const data: GscData[] = []
      
      // Parse CSV - skip header row
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim().replace(/"/g, ''))
        if (parts.length >= 4) {
          data.push({
            keyword: parts[0],
            impressions: parseInt(parts[1]) || 0,
            clicks: parseInt(parts[2]) || 0,
            position: parseFloat(parts[3]) || 0,
          })
        }
      }
      setGscData(data)
    }
    reader.readAsText(file)
  }, [])

  // Analyze competitor
  const analyzeCompetitor = useCallback(async () => {
    const competitorUrl = form.competitorUrls.split('\n')[0]?.trim()
    if (!competitorUrl || !form.targetKeyword) return
    
    setAnalyzingCompetitor(true)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: competitorUrl }),
      })
      const data = await res.json()
      if (!res.ok || data.error) return
      
      const competitorInput: SeoInput = {
        url: competitorUrl,
        competitorUrls: [],
        targetKeyword: form.targetKeyword.trim(),
        semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
        pageTitle: data.title || '',
        metaDescription: data.description || '',
        h1: data.h1 || '',
        bodyContent: data.bodyContent || '',
      }
      const competitorResult = analyzeSeo(competitorInput)
      setCompetitorAnalysis({ url: competitorUrl, result: competitorResult })
    } catch {
      // Silent fail
    } finally {
      setAnalyzingCompetitor(false)
    }
  }, [form.competitorUrls, form.targetKeyword, form.semanticKeywords])

  const pct = result?.percentage ?? 0

  return (
    <div className="min-h-screen" style={{ background: '#f0f2f5', fontFamily: 'Inter, sans-serif' }}>
      {/* ── Top nav ── */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
              style={{ background: '#4f7fff', color: '#fff' }}>S</div>
            <span className="font-semibold text-sm text-gray-800">SEO Dashboard</span>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['form', 'dashboard'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {tab === 'form' ? '⚙ Indstillinger' : '📊 Dashboard'}
              </button>
            ))}
          </div>
          {result && (
            <div className="flex items-center gap-2 text-sm">
              <span className={`font-bold tabular-nums ${pct >= 70 ? 'text-emerald-600' : pct >= 45 ? 'text-amber-600' : 'text-red-500'}`}>
                {pct}%
              </span>
              <span className="text-gray-400 text-xs">SEO Score</span>
            </div>
          )}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* ── FORM TAB ── */}
        {activeTab === 'form' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-up">

            {/* URL + Scrape */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">
                URL & Automatisk Hentning
              </h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="url"
                  placeholder="https://www.hounisen.com/nitrilhandsker"
                  value={form.url}
                  onChange={e => updateForm('url', e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
                  style={{ fontFamily: 'Inter, monospace' }}
                />
                <button
                  onClick={handleScrape}
                  disabled={!form.url || scraping}
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                  style={{ background: scraping ? '#94a3b8' : '#4f7fff' }}
                >
                  {scraping ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Henter...
                    </span>
                  ) : '🔍 Scrape side'}
                </button>
              </div>
              {scrapeError && (
                <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                  <span>⚠</span> {scrapeError}
                </p>
              )}
              <div className="mt-4">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">
                  Konkurrent URLs (én pr. linje)
                </label>
                <textarea
                  rows={2}
                  placeholder="https://www.konkurrent.dk/nitrilhandsker"
                  value={form.competitorUrls}
                  onChange={e => updateForm('competitorUrls', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none"
                  style={{ fontFamily: 'Inter, monospace' }}
                />
                {form.competitorUrls && form.targetKeyword && (
                  <button
                    onClick={analyzeCompetitor}
                    disabled={analyzingCompetitor}
                    className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: analyzingCompetitor ? '#94a3b8' : '#7c5cff' }}
                  >
                    {analyzingCompetitor ? 'Analyserer...' : '🔍 Analysér konkurrent'}
                  </button>
                )}
              </div>
            </div>

            {/* Keywords */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">
                Keywords
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">
                    Target keyword <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="f.eks. nitrilhandsker"
                    value={form.targetKeyword}
                    onChange={e => updateForm('targetKeyword', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">
                    Semantiske keywords <span className="text-gray-300">(kommasepareret)</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="pudderfri nitrilhandsker, latexallergi, engangshandsker, beskyttelseshandsker"
                    value={form.semanticKeywords}
                    onChange={e => updateForm('semanticKeywords', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">
                    Custom keyword-kombinationer <span className="text-gray-300">(kommasepareret)</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="køb nitrilhandsker, nitrilhandsker tilbud, bedste nitrilhandsker"
                    value={form.customKeywords}
                    onChange={e => updateForm('customKeywords', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none"
                  />
                  <p className="text-xs text-gray-400 mt-1.5">Varianter af dit primære keyword der scores separat</p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">
                    Google Search Console data <span className="text-gray-300">(valgfri CSV)</span>
                  </label>
                  <div className="relative">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleGscUpload}
                      className="hidden"
                      id="gsc-upload"
                    />
                    <label
                      htmlFor="gsc-upload"
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition cursor-pointer"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      {gscFileName || 'Upload GSC CSV (keyword, impressions, clicks, position)'}
                    </label>
                  </div>
                  {gscData.length > 0 && (
                    <p className="text-xs text-green-600 mt-1.5 font-medium">✓ {gscData.length} keywords indlæst fra GSC</p>
                  )}
                </div>
              </div>
            </div>

            {/* Meta */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">
                Meta Tags
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Title Tag</span>
                    <span className={`text-xs font-normal tabular-nums ${
                      form.pageTitle.length > 65 ? 'text-red-400' :
                      form.pageTitle.length >= 30 ? 'text-emerald-500' : 'text-gray-400'
                    }`}>{form.pageTitle.length}/65</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Nitrilhandsker – Pudderfri Engangshandsker | Hounisen"
                    value={form.pageTitle}
                    onChange={e => updateForm('pageTitle', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Meta Description</span>
                    <span className={`text-xs font-normal tabular-nums ${
                      form.metaDescription.length > 160 ? 'text-red-400' :
                      form.metaDescription.length >= 120 ? 'text-emerald-500' : 'text-gray-400'
                    }`}>{form.metaDescription.length}/160</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Køb pudderfri nitrilhandsker til laboratoriet – CE-mærket, latexfri og allergivenlig..."
                    value={form.metaDescription}
                    onChange={e => updateForm('metaDescription', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">
                Sideindhold
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">H1 Overskrift</label>
                  <input
                    type="text"
                    placeholder="Nitrilhandsker"
                    value={form.h1}
                    onChange={e => updateForm('h1', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Brødtekst / Indhold</span>
                    <span className={`text-xs font-normal tabular-nums ${
                      (result?.wordCount ?? 0) >= 500 ? 'text-emerald-500' :
                      (result?.wordCount ?? 0) >= 300 ? 'text-amber-500' : 'text-gray-400'
                    }`}>
                      {result?.wordCount ?? form.bodyContent.split(/\s+/).filter(Boolean).length} ord
                    </span>
                  </label>
                  <textarea
                    rows={8}
                    placeholder="Indsæt eller rediger sidens brødtekst her. Den opdateres automatisk ved scraping."
                    value={form.bodyContent}
                    onChange={e => updateForm('bodyContent', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-y"
                  />
                </div>
              </div>
            </div>

            {/* CTA */}
            {result && (
              <div className="lg:col-span-2 flex justify-center">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="px-8 py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-95 shadow-md"
                  style={{ background: 'linear-gradient(135deg, #4f7fff, #7c5cff)' }}
                >
                  Se dashboard →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === 'dashboard' && (
          <div className="space-y-5">
            {!result ? (
              <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
                <p className="text-gray-400 text-sm">Udfyld mindst et target keyword for at se analysen.</p>
                <button onClick={() => setActiveTab('form')}
                  className="mt-4 px-6 py-2.5 rounded-xl text-white text-sm font-semibold"
                  style={{ background: '#4f7fff' }}>
                  Gå til indstillinger →
                </button>
              </div>
            ) : (
              <>
                {/* Score card */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up">
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">SEO Score</p>
                  <div className="flex items-start gap-6">
                    <ScoreRing pct={pct} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="text-3xl font-extrabold text-gray-900 tabular-nums">{pct}<span className="text-lg text-gray-400 font-semibold">%</span></div>
                          <div className={`text-sm font-semibold mt-0.5 ${pct >= 70 ? 'text-emerald-600' : pct >= 45 ? 'text-amber-600' : 'text-red-500'}`}>
                            {pct >= 70 ? 'God' : pct >= 45 ? 'Middel – kan forbedres' : 'Kritisk – kræver handling'}
                          </div>
                        </div>
                        <div className="text-right text-sm text-gray-400">
                          Nå <span className="font-semibold text-gray-700">70%</span> for at matche<br />gennemsnitlige konkurrenter
                        </div>
                      </div>
                      <ProgressBar pct={pct} />
                      <div className="flex gap-4 mt-3">
                        <span className="text-xs text-gray-500">
                          <span className="font-semibold text-emerald-600">{result.keywordsFound}</span> keywords god
                        </span>
                        <span className="text-xs text-gray-500">
                          <span className="font-semibold text-amber-600">{result.keywordsOptimise}</span> optimer
                        </span>
                        <span className="text-xs text-gray-500">
                          <span className="font-semibold text-red-500">{result.keywordsMissing}</span> mangler
                        </span>
                        <span className="text-xs text-gray-500">
                          <span className="font-semibold text-gray-700">{result.wordCount}</span> ord
                        </span>
                      </div>
                    </div>
                  </div>
                  {form.url && (
                    <p className="mt-3 text-xs text-gray-400 font-mono truncate">URL: {form.url}</p>
                  )}
                </div>

                {/* Competitor comparison */}
                {competitorAnalysis && (
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-1">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">
                      Konkurrent-sammenligning
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Your site */}
                      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                        <div className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Din side</div>
                        <div className="flex items-baseline gap-2 mb-3">
                          <span className="text-3xl font-bold text-gray-900">{pct}%</span>
                          <span className="text-sm text-gray-500">SEO Score</span>
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Ordantal:</span>
                            <span className="font-semibold text-gray-900">{result?.wordCount || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Keywords fundet:</span>
                            <span className="font-semibold text-emerald-600">{result?.keywordsFound || 0}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Keywords mangler:</span>
                            <span className="font-semibold text-red-500">{result?.keywordsMissing || 0}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Competitor */}
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Konkurrent</div>
                        <div className="flex items-baseline gap-2 mb-3">
                          <span className="text-3xl font-bold text-gray-900">{competitorAnalysis.result.percentage}%</span>
                          <span className="text-sm text-gray-500">SEO Score</span>
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Ordantal:</span>
                            <span className="font-semibold text-gray-900">{competitorAnalysis.result.wordCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Keywords fundet:</span>
                            <span className="font-semibold text-emerald-600">{competitorAnalysis.result.keywordsFound}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Keywords mangler:</span>
                            <span className="font-semibold text-red-500">{competitorAnalysis.result.keywordsMissing}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Insights */}
                    <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                      <div className="font-semibold text-amber-900 mb-1">📊 Konklusioner:</div>
                      <ul className="text-amber-800 space-y-1 ml-4 list-disc">
                        {competitorAnalysis.result.wordCount > (result?.wordCount || 0) && (
                          <li>Konkurrenten har <strong>{competitorAnalysis.result.wordCount - (result?.wordCount || 0)} flere ord</strong> – overvej at uddybe indholdet</li>
                        )}
                        {competitorAnalysis.result.percentage > pct && (
                          <li>Konkurrenten scorer <strong>{competitorAnalysis.result.percentage - pct} point højere</strong> samlet</li>
                        )}
                        {competitorAnalysis.result.keywordsFound > (result?.keywordsFound || 0) && (
                          <li>Konkurrenten dækker <strong>{competitorAnalysis.result.keywordsFound - (result?.keywordsFound || 0)} flere keywords</strong></li>
                        )}
                        {pct > competitorAnalysis.result.percentage && (
                          <li className="text-green-700"><strong>✓ Du ligger foran!</strong> Din side scorer {pct - competitorAnalysis.result.percentage} point højere</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-1">
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">SEO Recommendations</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {result.recommendations.map(rec => (
                      <div key={rec.id}>
                        <button
                          onClick={() => setOpenRec(openRec === rec.id ? null : rec.id)}
                          className="w-full text-left flex items-center justify-between p-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition border border-transparent hover:border-gray-200"
                        >
                          <div>
                            <div className="text-xs font-bold tracking-wide uppercase text-gray-400 mb-1.5">{rec.label}</div>
                            <StatusPill status={rec.status} />
                          </div>
                          <span className="text-gray-300 text-lg font-light ml-2 flex-shrink-0">›</span>
                        </button>
                        {openRec === rec.id && (
                          <div className="mt-1 p-4 bg-white border border-gray-100 rounded-xl text-sm text-gray-600 leading-relaxed"
                            dangerouslySetInnerHTML={{ __html: rec.detail.replace(/\n/g, '<br/>') }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Keyword pills + table */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-2">
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Brug disse keywords mere</p>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {result.keywords.map(k => (
                      <span key={k.keyword}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-transform hover:scale-105 ${
                          k.status === 'God'
                            ? 'bg-emerald-50 text-emerald-700'
                            : k.status === 'Optimer'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-red-50 text-red-600 border border-red-200'
                        }`}>
                        {k.keyword}
                        {k.status === 'God' && <span className="text-emerald-500">✓</span>}
                        {k.currentCount > 0 && k.status !== 'God' && (
                          <span className="bg-black/10 rounded-full px-1.5">{k.currentCount}×</span>
                        )}
                      </span>
                    ))}
                  </div>

                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-3">Keyword Frekvens Tabel</p>
                  <div className="overflow-x-auto -mx-2">
                    <table className="w-full text-sm min-w-[480px]">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {['Keyword', 'Status', 'Anbefalet', 'Nuværende'].map(h => (
                            <th key={h} className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.keywords.map(k => (
                          <tr key={k.keyword} className="border-b border-gray-50 hover:bg-gray-50 transition">
                            <td className="py-3 px-3 font-medium text-gray-800">{k.keyword}</td>
                            <td className="py-3 px-3"><KwStatusTag status={k.status} /></td>
                            <td className="py-3 px-3 text-gray-400 tabular-nums text-xs">{k.recommendedMin}–{k.recommendedMax}×</td>
                            <td className="py-3 px-3 text-gray-400 tabular-nums text-xs font-semibold">{k.currentCount}×</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Custom Keywords section */}
                {form.customKeywords && (
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-3">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Custom Keyword-kombinationer</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {form.customKeywords.split(',').map(kw => kw.trim()).filter(Boolean).map((kw, i) => {
                        const text = [form.pageTitle, form.metaDescription, form.h1, form.bodyContent].join(' ').toLowerCase()
                        const count = (text.match(new RegExp(kw.toLowerCase(), 'g')) || []).length
                        const status = count === 0 ? 'red' : count < 2 ? 'yellow' : 'green'
                        return (
                          <span key={i}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-transform hover:scale-105 ${
                              status === 'green'
                                ? 'bg-emerald-50 text-emerald-700'
                                : status === 'yellow'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-600 border border-red-200'
                            }`}>
                            {kw}
                            {status === 'green' && <span className="text-emerald-500">✓</span>}
                            {count > 0 && status !== 'green' && (
                              <span className="bg-black/10 rounded-full px-1.5">{count}×</span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                    <p className="text-xs text-gray-400">Disse keyword-kombinationer tæller <strong>ikke</strong> i den samlede SEO-score, men viser om du dækker long-tail varianter.</p>
                  </div>
                )}

                {/* GSC Data comparison */}
                {gscData.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-3">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Google Search Console Data</p>
                    <div className="overflow-x-auto -mx-2">
                      <table className="w-full text-sm min-w-[480px]">
                        <thead>
                          <tr className="border-b border-gray-100">
                            {['Keyword', 'Impressions', 'Clicks', 'Position', 'På siden?'].map(h => (
                              <th key={h} className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {gscData.slice(0, 10).map((row, i) => {
                            const text = [form.pageTitle, form.metaDescription, form.h1, form.bodyContent].join(' ').toLowerCase()
                            const onPage = text.includes(row.keyword.toLowerCase())
                            return (
                              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                <td className="py-3 px-3 font-medium text-gray-800">{row.keyword}</td>
                                <td className="py-3 px-3 text-gray-600 tabular-nums">{row.impressions.toLocaleString()}</td>
                                <td className="py-3 px-3 text-gray-600 tabular-nums">{row.clicks.toLocaleString()}</td>
                                <td className="py-3 px-3 text-gray-600 tabular-nums">{row.position.toFixed(1)}</td>
                                <td className="py-3 px-3">
                                  {onPage ? (
                                    <span className="text-emerald-600 text-xs font-semibold">✓ Ja</span>
                                  ) : (
                                    <span className="text-red-500 text-xs font-semibold">✗ Nej</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {gscData.length > 10 && (
                      <p className="text-xs text-gray-400 mt-3">Viser top 10 af {gscData.length} keywords fra GSC</p>
                    )}
                  </div>
                )}

                {/* Content gaps */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-3">
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Content Gap Analyse</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {result.contentGaps.map(gap => (
                      <div key={gap.num}
                        className="bg-gray-50 rounded-xl p-5 hover:shadow-md transition-all hover:-translate-y-0.5"
                        style={{ borderTop: `3px solid ${gap.color}` }}>
                        <div className="text-xs font-bold tracking-wider uppercase text-gray-400 mb-2">{gap.num}</div>
                        <h3 className="font-bold text-gray-800 mb-2 text-sm leading-snug">{gap.title}</h3>
                        <p className="text-xs text-gray-500 leading-relaxed">{gap.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick wins */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-4">
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Quick Wins – Prioriteret Rækkefølge</p>
                  <div className="space-y-3">
                    {result.quickWins.map((w, i) => (
                      <div key={i} className="flex items-start gap-3 p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition border border-transparent hover:border-gray-200">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${
                          w.priority === 'red' ? 'bg-red-400' :
                          w.priority === 'yellow' ? 'bg-amber-400' : 'bg-emerald-400'
                        }`} />
                        <div>
                          <div className="font-semibold text-sm text-gray-800 mb-0.5">{w.title}</div>
                          <div className="text-xs text-gray-500 leading-relaxed">{w.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Back to edit button */}
                <div className="flex justify-center pt-2">
                  <button onClick={() => setActiveTab('form')}
                    className="text-xs text-gray-400 hover:text-gray-600 transition underline underline-offset-2">
                    ← Redigér indstillinger
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <footer className="text-center py-8 text-xs text-gray-300 tracking-widest uppercase">
        SEO Dashboard · Hounisen · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
