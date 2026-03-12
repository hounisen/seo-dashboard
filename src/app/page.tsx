'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
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

// Snapshot of scraped content – never changes after scrape
interface ScrapedSnapshot {
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

// ── Live Editor Panel ─────────────────────────────────────────────────────────
interface LiveEditorProps {
  scraped: ScrapedSnapshot
  form: FormState
  updateForm: (key: keyof FormState, val: string) => void
  result: SeoResult | null
  originalResult: SeoResult | null
}

function ScoreDelta({ current, original }: { current: number; original: number }) {
  const delta = current - original
  if (delta === 0) return null
  return (
    <span className={`ml-2 text-xs font-bold px-1.5 py-0.5 rounded ${delta > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
      {delta > 0 ? `+${delta}` : delta}%
    </span>
  )
}

function LiveEditor({ scraped, form, updateForm, result, originalResult }: LiveEditorProps) {
  const pct = result?.percentage ?? 0
  const origPct = originalResult?.percentage ?? 0
  const delta = pct - origPct

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100" style={{ background: 'linear-gradient(135deg, #f8f9ff 0%, #eef2ff 100%)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-0.5">Live Tekst Editor</p>
            <p className="text-xs text-gray-500">Rediger direkte herunder – scoren opdateres øjeblikkeligt</p>
          </div>
          {originalResult && (
            <div className="text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="text-xs text-gray-400">Score</span>
                <span className={`text-2xl font-extrabold tabular-nums ${pct >= 70 ? 'text-emerald-600' : pct >= 45 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</span>
                {delta !== 0 && (
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${delta > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Originalt: {origPct}%</p>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Title */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">Title Tag</label>
            <div className="flex items-center gap-2">
              {originalResult && result && (
                <ScoreDelta
                  current={result.recommendations.find(r => r.id === 'title')?.status === 'ok' ? 15 : result.recommendations.find(r => r.id === 'title')?.status === 'warn' ? 10 : 0}
                  original={originalResult.recommendations.find(r => r.id === 'title')?.status === 'ok' ? 15 : originalResult.recommendations.find(r => r.id === 'title')?.status === 'warn' ? 10 : 0}
                />
              )}
              <span className={`text-xs tabular-nums font-semibold ${form.pageTitle.length > 65 ? 'text-red-400' : form.pageTitle.length >= 30 ? 'text-emerald-500' : 'text-gray-400'}`}>
                {form.pageTitle.length}/65
              </span>
            </div>
          </div>
          {scraped.pageTitle && scraped.pageTitle !== form.pageTitle && (
            <p className="text-xs text-gray-400 mb-1.5 line-through truncate" title="Original">
              {scraped.pageTitle}
            </p>
          )}
          <input
            type="text"
            value={form.pageTitle}
            onChange={e => updateForm('pageTitle', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition ${
              scraped.pageTitle && scraped.pageTitle !== form.pageTitle
                ? 'border-indigo-200 bg-indigo-50/30'
                : 'border-gray-200'
            }`}
            placeholder="Skriv din title tag..."
          />
        </div>

        {/* Meta description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">Meta Description</label>
            <span className={`text-xs tabular-nums font-semibold ${form.metaDescription.length > 160 ? 'text-red-400' : form.metaDescription.length >= 120 ? 'text-emerald-500' : 'text-gray-400'}`}>
              {form.metaDescription.length}/160
            </span>
          </div>
          {scraped.metaDescription && scraped.metaDescription !== form.metaDescription && (
            <p className="text-xs text-gray-400 mb-1.5 line-through line-clamp-2" title="Original">
              {scraped.metaDescription}
            </p>
          )}
          <textarea
            rows={3}
            value={form.metaDescription}
            onChange={e => updateForm('metaDescription', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-none ${
              scraped.metaDescription && scraped.metaDescription !== form.metaDescription
                ? 'border-indigo-200 bg-indigo-50/30'
                : 'border-gray-200'
            }`}
            placeholder="Skriv din meta description..."
          />
        </div>

        {/* H1 */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">H1 Overskrift</label>
          </div>
          {scraped.h1 && scraped.h1 !== form.h1 && (
            <p className="text-xs text-gray-400 mb-1.5 line-through truncate" title="Original">
              {scraped.h1}
            </p>
          )}
          <input
            type="text"
            value={form.h1}
            onChange={e => updateForm('h1', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition ${
              scraped.h1 && scraped.h1 !== form.h1
                ? 'border-indigo-200 bg-indigo-50/30'
                : 'border-gray-200'
            }`}
            placeholder="Skriv din H1..."
          />
        </div>

        {/* Body content */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">Brødtekst / Indhold</label>
            <div className="flex items-center gap-2">
              {result && originalResult && result.wordCount !== originalResult.wordCount && (
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${result.wordCount > originalResult.wordCount ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                  {result.wordCount > originalResult.wordCount ? '+' : ''}{result.wordCount - originalResult.wordCount} ord
                </span>
              )}
              <span className={`text-xs tabular-nums font-semibold ${(result?.wordCount ?? 0) >= 800 ? 'text-emerald-500' : (result?.wordCount ?? 0) >= 300 ? 'text-amber-500' : 'text-gray-400'}`}>
                {result?.wordCount ?? form.bodyContent.split(/\s+/).filter(Boolean).length} ord
              </span>
            </div>
          </div>
          <textarea
            rows={10}
            value={form.bodyContent}
            onChange={e => updateForm('bodyContent', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-y ${
              scraped.bodyContent && scraped.bodyContent !== form.bodyContent
                ? 'border-indigo-200 bg-indigo-50/30'
                : 'border-gray-200'
            }`}
            placeholder="Indsæt eller rediger sidens brødtekst..."
          />
        </div>

        {/* Reset button */}
        {(scraped.pageTitle || scraped.metaDescription || scraped.h1 || scraped.bodyContent) && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {[
                scraped.pageTitle !== form.pageTitle && 'title',
                scraped.metaDescription !== form.metaDescription && 'meta',
                scraped.h1 !== form.h1 && 'H1',
                scraped.bodyContent !== form.bodyContent && 'indhold',
              ].filter(Boolean).join(', ') || 'Ingen ændringer'}
              {[scraped.pageTitle !== form.pageTitle, scraped.metaDescription !== form.metaDescription, scraped.h1 !== form.h1, scraped.bodyContent !== form.bodyContent].some(Boolean)
                ? ' ændret'
                : ''}
            </p>
            <button
              onClick={() => {
                updateForm('pageTitle', scraped.pageTitle)
                updateForm('metaDescription', scraped.metaDescription)
                updateForm('h1', scraped.h1)
                updateForm('bodyContent', scraped.bodyContent)
              }}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold transition"
            >
              ↺ Nulstil til original
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SeoDashboard() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [scraped, setScraped] = useState<ScrapedSnapshot>({ pageTitle: '', metaDescription: '', h1: '', bodyContent: '' })
  const [result, setResult] = useState<SeoResult | null>(null)
  const [originalResult, setOriginalResult] = useState<SeoResult | null>(null)
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState('')
  const [openRec, setOpenRec] = useState<string | null>(null)
  const [gscData, setGscData] = useState<GscData[]>([])
  const [gscFileName, setGscFileName] = useState('')
  const [competitorAnalysis, setCompetitorAnalysis] = useState<{url: string, result: SeoResult}[]>([])
  const [analyzingCompetitor, setAnalyzingCompetitor] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
      const newTitle = data.title || ''
      const newMeta = data.description || ''
      const newH1 = data.h1 || ''
      const newBody = data.bodyContent || ''

      // Save snapshot of scraped content
      setScraped({ pageTitle: newTitle, metaDescription: newMeta, h1: newH1, bodyContent: newBody })

      setForm(prev => ({
        ...prev,
        pageTitle: newTitle || prev.pageTitle,
        metaDescription: newMeta || prev.metaDescription,
        h1: newH1 || prev.h1,
        bodyContent: newBody || prev.bodyContent,
      }))

      // Compute and lock in the "original" score from scraped content
      if (form.targetKeyword) {
        const origInput: SeoInput = {
          url: form.url,
          competitorUrls: [],
          targetKeyword: form.targetKeyword.trim(),
          semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
          pageTitle: newTitle,
          metaDescription: newMeta,
          h1: newH1,
          bodyContent: newBody,
        }
        setOriginalResult(analyzeSeo(origInput))
      }
    } catch {
      setScrapeError('Netværksfejl – tjek din forbindelse')
    } finally {
      setScraping(false)
    }
  }, [form.url, form.targetKeyword, form.semanticKeywords])

  // Also set originalResult when keywords change after a scrape (if scraped data exists)
  useEffect(() => {
    if (!form.targetKeyword || !scraped.pageTitle) return
    const origInput: SeoInput = {
      url: form.url,
      competitorUrls: [],
      targetKeyword: form.targetKeyword.trim(),
      semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
      pageTitle: scraped.pageTitle,
      metaDescription: scraped.metaDescription,
      h1: scraped.h1,
      bodyContent: scraped.bodyContent,
    }
    setOriginalResult(analyzeSeo(origInput))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.targetKeyword, form.semanticKeywords, scraped])

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

  // Analyze competitor(s) - up to 2 competitors
  const analyzeCompetitor = useCallback(async () => {
    const competitorUrls = form.competitorUrls
      .split('\n')
      .map(u => u.trim())
      .filter(Boolean)
      .slice(0, 2)
    if (competitorUrls.length === 0 || !form.targetKeyword) return
    setAnalyzingCompetitor(true)
    try {
      const results = await Promise.all(
        competitorUrls.map(async (competitorUrl) => {
          try {
            const res = await fetch('/api/scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: competitorUrl }),
            })
            const data = await res.json()
            if (!res.ok || data.error) return null
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
            return { url: competitorUrl, result: competitorResult }
          } catch {
            return null
          }
        })
      )
      setCompetitorAnalysis(results.filter(Boolean) as {url: string, result: SeoResult}[])
    } catch {
      // Silent fail
    } finally {
      setAnalyzingCompetitor(false)
    }
  }, [form.competitorUrls, form.targetKeyword, form.semanticKeywords])

  const pct = result?.percentage ?? 0

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f2f5', fontFamily: 'Inter, sans-serif' }}>
      {/* ── Top nav ── */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
              style={{ background: '#4f7fff', color: '#fff' }}>S</div>
            <span className="font-semibold text-sm text-gray-800">SEO Dashboard</span>
          </div>
          {result && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-bold tabular-nums ${pct >= 70 ? 'text-emerald-600' : pct >= 45 ? 'text-amber-600' : 'text-red-500'}`}>
                  {pct}%
                </span>
                {originalResult && pct !== originalResult.percentage && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${pct > originalResult.percentage ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {pct > originalResult.percentage ? '▲' : '▼'} {Math.abs(pct - originalResult.percentage)}%
                  </span>
                )}
                <span className="text-gray-400 text-xs">SEO Score</span>
              </div>
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition"
              >
                {sidebarCollapsed ? '← Vis indstillinger' : 'Skjul indstillinger →'}
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* ── SPLIT VIEW LAYOUT ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT SIDEBAR - Settings (40%) */}
        <div className={`${sidebarCollapsed ? 'w-0' : 'w-full lg:w-[40%]'} overflow-y-auto border-r border-gray-200 bg-white transition-all duration-300`}>
          <div className={`${sidebarCollapsed ? 'hidden' : 'block'} p-6 space-y-6`}>

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
                <button
                  onClick={() => {
                    if (confirm('Ryd alle felter og start forfra?')) {
                      setForm(DEFAULT_FORM)
                      setScraped({ pageTitle: '', metaDescription: '', h1: '', bodyContent: '' })
                      setOriginalResult(null)
                      setGscData([])
                      setGscFileName('')
                      setCompetitorAnalysis([])
                      setScrapeError('')
                    }
                  }}
                  className="px-6 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold transition-all active:scale-95"
                  title="Ryd alle felter">
                  🗑️ Ryd alt
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
                    <input type="file" accept=".csv" onChange={handleGscUpload} className="hidden" id="gsc-upload" />
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

            {/* Meta (read-only context – editing happens in Live Editor) */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">
                Meta Tags
              </h2>
              <p className="text-xs text-gray-400 mb-4">Rediger i <span className="font-semibold text-indigo-500">Live Editor</span> til højre for øjeblikkelig score-feedback</p>
              <div className="space-y-3 pointer-events-none opacity-60">
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Title Tag</span>
                    <span className="text-xs font-normal tabular-nums text-gray-400">{form.pageTitle.length}/65</span>
                  </label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 truncate min-h-[42px]">
                    {form.pageTitle || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Meta Description</span>
                    <span className="text-xs font-normal tabular-nums text-gray-400">{form.metaDescription.length}/160</span>
                  </label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 line-clamp-2 min-h-[42px]">
                    {form.metaDescription || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Sideindhold (read-only context) */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 lg:col-span-2">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">
                Sideindhold
              </h2>
              <p className="text-xs text-gray-400 mb-4">Rediger i <span className="font-semibold text-indigo-500">Live Editor</span> til højre</p>
              <div className="space-y-3 pointer-events-none opacity-60">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">H1 Overskrift</label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 truncate min-h-[42px]">
                    {form.h1 || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Brødtekst / Indhold</span>
                    <span className="text-xs font-normal tabular-nums text-gray-400">
                      {result?.wordCount ?? form.bodyContent.split(/\s+/).filter(Boolean).length} ord
                    </span>
                  </label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 line-clamp-3 min-h-[60px]">
                    {form.bodyContent || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL - Results (60%) */}
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <div className="max-w-5xl mx-auto space-y-5">
            {!result ? (
              <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
                <p className="text-gray-400 text-sm">Udfyld target keyword og scrape URL for at se analysen.</p>
                <p className="text-gray-500 text-xs mt-2">Resultaterne vises live her mens du ændrer indstillinger ←</p>
              </div>
            ) : (
              <>
                {/* Score Ring */}
                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up">
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">SEO Score</p>
                  <div className="flex items-start gap-6">
                    <ScoreRing pct={pct} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-baseline gap-2">
                            <div className="text-3xl font-extrabold text-gray-900 tabular-nums">{pct}<span className="text-lg text-gray-400 font-semibold">%</span></div>
                            {originalResult && pct !== originalResult.percentage && (
                              <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${pct > originalResult.percentage ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                {pct > originalResult.percentage ? '▲' : '▼'} {Math.abs(pct - originalResult.percentage)}% ift. original
                              </span>
                            )}
                          </div>
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

                {/* ── LIVE EDITOR ── */}
                {scraped.pageTitle || scraped.metaDescription || scraped.h1 || scraped.bodyContent ? (
                  <LiveEditor
                    scraped={scraped}
                    form={form}
                    updateForm={updateForm}
                    result={result}
                    originalResult={originalResult}
                  />
                ) : (
                  // Show editor even without scrape, just without diff markers
                  <LiveEditor
                    scraped={{ pageTitle: '', metaDescription: '', h1: '', bodyContent: '' }}
                    form={form}
                    updateForm={updateForm}
                    result={result}
                    originalResult={originalResult}
                  />
                )}

                {/* Competitor comparison */}
                {competitorAnalysis.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-1">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">
                      Konkurrent-Sammenligning (Benchmarks)
                    </p>
                    <div className="overflow-x-auto -mx-2 mb-6">
                      <table className="w-full text-sm min-w-[600px]">
                        <thead>
                          <tr className="border-b-2 border-gray-200">
                            <th className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">Metrik</th>
                            <th className="text-center text-xs font-bold tracking-widest uppercase text-blue-600 pb-3 px-3">Din Side</th>
                            {competitorAnalysis.map((comp, i) => (
                              <th key={i} className="text-center text-xs font-bold tracking-widest uppercase text-gray-600 pb-3 px-3">
                                Konkurrent {i + 1}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-3 text-gray-600 font-medium">Ordantal</td>
                            <td className="py-3 px-3 text-center">
                              <span className={`font-bold ${(result?.wordCount || 0) >= Math.max(...competitorAnalysis.map(c => c.result.wordCount)) ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {result?.wordCount || 0}
                              </span>
                            </td>
                            {competitorAnalysis.map((comp, i) => (
                              <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold">{comp.result.wordCount}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-3 text-gray-600 font-medium">Keywords Dækket</td>
                            <td className="py-3 px-3 text-center">
                              <span className="font-bold text-emerald-600">{result?.keywordsFound || 0}/{(result?.keywordsFound || 0) + (result?.keywordsMissing || 0)}</span>
                            </td>
                            {competitorAnalysis.map((comp, i) => (
                              <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold">
                                {comp.result.keywordsFound}/{comp.result.keywordsFound + comp.result.keywordsMissing}
                              </td>
                            ))}
                          </tr>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-3 text-gray-600 font-medium">Readability</td>
                            <td className="py-3 px-3 text-center font-bold text-gray-800">{result?.readabilityScore || 'Medium'}</td>
                            {competitorAnalysis.map((comp, i) => (
                              <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold">{comp.result.readabilityScore}</td>
                            ))}
                          </tr>
                          <tr className="border-b border-gray-100">
                            <td className="py-3 px-3 text-gray-600 font-medium">Structured Data</td>
                            <td className="py-3 px-3 text-center">
                              {result && result.recommendations.find(r => r.id === 'structured-data')?.status === 'ok' ? (
                                <span className="text-emerald-600 font-bold">✓</span>
                              ) : (
                                <span className="text-red-500 font-bold">✗</span>
                              )}
                            </td>
                            {competitorAnalysis.map((comp, i) => (
                              <td key={i} className="py-3 px-3 text-center">
                                {comp.result.recommendations.find(r => r.id === 'structured-data')?.status === 'ok' ? (
                                  <span className="text-emerald-600 font-bold">✓</span>
                                ) : (
                                  <span className="text-red-500 font-bold">✗</span>
                                )}
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <td className="py-3 px-3 text-gray-600 font-medium">SEO Score</td>
                            <td className="py-3 px-3 text-center">
                              <span className={`text-2xl font-bold ${pct >= Math.max(...competitorAnalysis.map(c => c.result.percentage)) ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {pct}%
                              </span>
                            </td>
                            {competitorAnalysis.map((comp, i) => (
                              <td key={i} className="py-3 px-3 text-center text-gray-700 text-2xl font-bold">{comp.result.percentage}%</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                      <div className="font-semibold text-blue-900 mb-2">📊 Nøgleindsigter:</div>
                      <ul className="text-blue-800 space-y-1.5 ml-4 list-disc">
                        {(() => {
                          const maxCompWordCount = Math.max(...competitorAnalysis.map(c => c.result.wordCount))
                          const maxCompKeywords = Math.max(...competitorAnalysis.map(c => c.result.keywordsFound))
                          const maxCompScore = Math.max(...competitorAnalysis.map(c => c.result.percentage))
                          return (
                            <>
                              {maxCompWordCount > (result?.wordCount || 0) && (
                                <li>Top konkurrent har <strong>{maxCompWordCount - (result?.wordCount || 0)} flere ord</strong> – overvej at uddybe indholdet</li>
                              )}
                              {(result?.wordCount || 0) > maxCompWordCount && (
                                <li className="text-emerald-700"><strong>✓ Du har dybere indhold</strong> end alle konkurrenter med {(result?.wordCount || 0) - maxCompWordCount} flere ord</li>
                              )}
                              {(result?.keywordsFound || 0) > maxCompKeywords && (
                                <li className="text-emerald-700"><strong>✓ Bedre keyword-dækning</strong> – du dækker {(result?.keywordsFound || 0) - maxCompKeywords} flere keywords end top konkurrent</li>
                              )}
                              {maxCompKeywords > (result?.keywordsFound || 0) && (
                                <li>Top konkurrent dækker <strong>{maxCompKeywords - (result?.keywordsFound || 0)} flere keywords</strong></li>
                              )}
                              {pct > maxCompScore ? (
                                <li className="text-emerald-700"><strong>✓ Du ligger foran!</strong> Din side scorer {pct - maxCompScore} point højere end den bedste konkurrent</li>
                              ) : pct < maxCompScore && (
                                <li>Top konkurrent scorer <strong>{maxCompScore - pct} point højere</strong> samlet</li>
                              )}
                            </>
                          )
                        })()}
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
                  <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Keyword Status</p>
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

                {/* GSC Data */}
                {gscData.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-3">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Google Search Console Data</p>
                    <div className="overflow-x-auto -mx-2">
                      <table className="w-full text-sm min-w-[480px]">
                        <thead>
                          <tr className="border-b border-gray-100">
                            {['Keyword', 'Clicks', 'Impressions', 'Position', 'På siden?'].map(h => (
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
                                <td className="py-3 px-3 text-gray-600 tabular-nums">{row.clicks.toLocaleString()}</td>
                                <td className="py-3 px-3 text-gray-600 tabular-nums">{row.impressions.toLocaleString()}</td>
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

                {/* GSC Keyword Gap */}
                {gscData.length > 0 && (
                  <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-3">
                    <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-2">GSC Keyword Gap Analysis</p>
                    <p className="text-sm text-gray-600 mb-4">Quick wins baseret på dine faktiske Google data</p>
                    {(() => {
                      const text = [form.pageTitle, form.metaDescription, form.h1, form.bodyContent].join(' ').toLowerCase()
                      const missingHighImpression = gscData
                        .filter(row => !text.includes(row.keyword.toLowerCase()) && row.impressions > 0)
                        .sort((a, b) => b.impressions - a.impressions).slice(0, 5)
                      const lowPosition = gscData
                        .filter(row => row.position >= 4 && row.position <= 15 && row.impressions > 5)
                        .sort((a, b) => b.impressions - a.impressions).slice(0, 5)
                      const highImpressionLowCtr = gscData
                        .filter(row => { const ctr = row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0; return row.impressions >= 50 && ctr < 5 })
                        .sort((a, b) => b.impressions - a.impressions).slice(0, 5)
                      return (
                        <div className="space-y-4">
                          {missingHighImpression.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-xl">🎯</span>
                                <div>
                                  <h4 className="text-sm font-bold text-amber-900">Low-Hanging Fruit</h4>
                                  <p className="text-xs text-amber-700">Keywords der giver impressions, men mangler på siden</p>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {missingHighImpression.map((row, i) => (
                                  <div key={i} className="flex items-center justify-between p-2 bg-white rounded-lg border border-amber-100">
                                    <div className="flex-1">
                                      <span className="font-semibold text-gray-800 text-sm">{row.keyword}</span>
                                      <div className="text-xs text-gray-500 mt-0.5">{row.impressions.toLocaleString()} impressions · {row.clicks.toLocaleString()} clicks · Pos {row.position.toFixed(1)}</div>
                                    </div>
                                    <span className="px-2 py-1 bg-amber-100 text-amber-800 text-xs font-semibold rounded">Tilføj til tekst</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {lowPosition.length > 0 && (
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-xl">📈</span>
                                <div>
                                  <h4 className="text-sm font-bold text-blue-900">Tæt på Top 3</h4>
                                  <p className="text-xs text-blue-700">Små forbedringer kan give stor traffic-stigning</p>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {lowPosition.map((row, i) => {
                                  const estimatedBoost = Math.round(row.impressions * (0.3 - (row.clicks / row.impressions)))
                                  return (
                                    <div key={i} className="flex items-center justify-between p-2 bg-white rounded-lg border border-blue-100">
                                      <div className="flex-1">
                                        <span className="font-semibold text-gray-800 text-sm">{row.keyword}</span>
                                        <div className="text-xs text-gray-500 mt-0.5">Position #{row.position.toFixed(1)} · {row.impressions.toLocaleString()} impressions</div>
                                      </div>
                                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded">+{estimatedBoost} clicks</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {highImpressionLowCtr.length > 0 && (
                            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                              <div className="flex items-center gap-2 mb-3">
                                <span className="text-xl">💡</span>
                                <div>
                                  <h4 className="text-sm font-bold text-purple-900">Forbedr Title/Meta</h4>
                                  <p className="text-xs text-purple-700">Høje visninger men lav CTR – optimér beskrivelser</p>
                                </div>
                              </div>
                              <div className="space-y-2">
                                {highImpressionLowCtr.map((row, i) => {
                                  const ctr = row.impressions > 0 ? ((row.clicks / row.impressions) * 100).toFixed(1) : '0'
                                  return (
                                    <div key={i} className="flex items-center justify-between p-2 bg-white rounded-lg border border-purple-100">
                                      <div className="flex-1">
                                        <span className="font-semibold text-gray-800 text-sm">{row.keyword}</span>
                                        <div className="text-xs text-gray-500 mt-0.5">{row.impressions.toLocaleString()} impressions · CTR {ctr}%</div>
                                      </div>
                                      <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded">Lav CTR</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                          {missingHighImpression.length === 0 && lowPosition.length === 0 && highImpressionLowCtr.length === 0 && (
                            <div className="text-center py-8 text-gray-400 text-sm">Ingen umiddelbare quick wins fundet i GSC-data. Din side performer stærkt! 🎉</div>
                          )}
                        </div>
                      )
                    })()}
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

                {/* Keyword Sections */}
                {(() => {
                  const optimizeKeywords = result.keywords.filter(k => k.status === 'Optimer')
                  const missingKeywords = result.keywords.filter(k => k.status === 'Mangler')
                  const customKeywordsArray = form.customKeywords.split(',').map(k => k.trim()).filter(Boolean)
                  return (
                    <>
                      {optimizeKeywords.length > 0 && (
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-5">
                          <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Use These Keywords More</p>
                          <div className="flex flex-wrap gap-2">
                            {optimizeKeywords.map((kw, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                {kw.keyword}
                                <span className="text-amber-500">({kw.currentCount})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {missingKeywords.length > 0 && (
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-6">
                          <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Consider Semantic Rich Keywords</p>
                          <div className="flex flex-wrap gap-2">
                            {missingKeywords.map((kw, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">
                                {kw.keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {customKeywordsArray.length > 0 && (
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-7">
                          <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Custom Keywords</p>
                          <div className="flex flex-wrap gap-2">
                            {customKeywordsArray.map((kw, i) => {
                              const text = [form.pageTitle, form.metaDescription, form.h1, form.bodyContent].join(' ').toLowerCase()
                              const normalizedKeyword = kw.toLowerCase().trim().replace(/\s+/g, '\\s*')
                              const matches = text.match(new RegExp(normalizedKeyword, 'g'))
                              const count = matches ? matches.length : 0
                              const found = count > 0
                              return (
                                <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                                  found ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600 border border-red-200'
                                }`}>
                                  {kw}
                                  {found && <span className="text-emerald-500">✓</span>}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="bg-white border-t border-gray-100 py-3 text-center text-xs text-gray-400">
        SEO Dashboard · Hounisen · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
