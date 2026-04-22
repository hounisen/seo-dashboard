'use client'

import { useState, useCallback, useEffect } from 'react'
import { analyzeSeo, SeoInput, SeoResult, KeywordStatus } from '@/lib/seoEngine'

// ── Types ─────────────────────────────────────────────────────────────────────
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
  structuredDataTypes: string[]
}

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

interface AhrefsRow {
  keyword: string
  prevPosition: number | null
  currPosition: number | null
  posChange: number | null
  volume: number
  primaryUrl: string
  otherUrls: string[]
  clicks: number
  impressions: number
  ctr: number
  gscPosition: number
}

const SCHEMA_TYPES = [
  { id: 'Product',        label: 'Product',        icon: '🛒' },
  { id: 'FAQPage',        label: 'FAQ Page',        icon: '❓' },
  { id: 'Organization',   label: 'Organization',   icon: '🏢' },
  { id: 'HotelRoom',      label: 'Hotel Room',     icon: '🛏️' },
  { id: 'LocalBusiness',  label: 'Local Business', icon: '📍' },
  { id: 'Article',        label: 'Article',        icon: '📄' },
  { id: 'BreadcrumbList', label: 'Breadcrumb',     icon: '🔗' },
  { id: 'ItemList',       label: 'Item List',      icon: '📋' },
  { id: 'Carousel',       label: 'Karrusel',       icon: '🎠' },
]

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
  structuredDataTypes: [],
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
      <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset} transform="rotate(-90 55 55)"
        style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1), stroke 0.3s' }} />
      <text x="55" y="55" textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 20, fontWeight: 800, fontFamily: 'Inter, sans-serif', fill: '#1a1a2e' }}>{pct}</text>
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
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  )
}

function KwStatusTag({ status }: { status: KeywordStatus }) {
  const map = { God: 'bg-emerald-50 text-emerald-700', Optimer: 'bg-amber-50 text-amber-700', Mangler: 'bg-red-50 text-red-600' }
  const dots = { God: 'bg-emerald-400', Optimer: 'bg-amber-400', Mangler: 'bg-red-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />{status}
    </span>
  )
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="relative h-4 rounded-full overflow-hidden"
      style={{ background: 'linear-gradient(90deg, #ff4d6a 0%, #ff8c42 20%, #ffb547 40%, #a8d85e 60%, #2dce89 80%, #e0e4ea 80%)' }}>
      <div className="absolute top-[-5px] w-0 h-0 transition-all duration-1000 ease-out"
        style={{ left: `${Math.min(pct * 0.8 + 1, 79)}%`, borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent', borderTop: '10px solid #1a1a2e', transform: 'translateX(-50%)' }} />
    </div>
  )
}

// ── Live Editor ───────────────────────────────────────────────────────────────
function ScoreDelta({ current, original }: { current: number; original: number }) {
  const delta = current - original
  if (delta === 0) return null
  return (
    <span className={`ml-2 text-xs font-bold px-1.5 py-0.5 rounded ${delta > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
      {delta > 0 ? `+${delta}` : delta}%
    </span>
  )
}

interface LiveEditorProps {
  scraped: ScrapedSnapshot
  form: FormState
  updateForm: (key: keyof FormState, val: string) => void
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  result: SeoResult | null
  originalResult: SeoResult | null
}

function LiveEditor({ scraped, form, updateForm, setForm, result, originalResult }: LiveEditorProps) {
  const pct = result?.percentage ?? 0
  const origPct = originalResult?.percentage ?? 0
  const delta = pct - origPct
  const hasChanges = scraped.pageTitle !== form.pageTitle || scraped.metaDescription !== form.metaDescription ||
    scraped.h1 !== form.h1 || scraped.bodyContent !== form.bodyContent

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100" style={{ background: 'linear-gradient(135deg, #f8f9ff 0%, #eef2ff 100%)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold tracking-widest uppercase text-indigo-400 mb-0.5">Live Tekst Editor</p>
            <p className="text-xs text-gray-500">Rediger direkte – scoren opdateres øjeblikkeligt</p>
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
            <span className={`text-xs tabular-nums font-semibold ${form.pageTitle.length > 65 ? 'text-red-400' : form.pageTitle.length >= 30 ? 'text-emerald-500' : 'text-gray-400'}`}>
              {form.pageTitle.length}/65
            </span>
          </div>
          {scraped.pageTitle && scraped.pageTitle !== form.pageTitle && (
            <p className="text-xs text-gray-400 mb-1.5 line-through truncate">{scraped.pageTitle}</p>
          )}
          <input type="text" value={form.pageTitle} onChange={e => updateForm('pageTitle', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition ${scraped.pageTitle && scraped.pageTitle !== form.pageTitle ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`}
            placeholder="Skriv din title tag..." />
        </div>
        {/* Meta */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">Meta Description</label>
            <span className={`text-xs tabular-nums font-semibold ${form.metaDescription.length > 160 ? 'text-red-400' : form.metaDescription.length >= 120 ? 'text-emerald-500' : 'text-gray-400'}`}>
              {form.metaDescription.length}/160
            </span>
          </div>
          {scraped.metaDescription && scraped.metaDescription !== form.metaDescription && (
            <p className="text-xs text-gray-400 mb-1.5 line-through line-clamp-2">{scraped.metaDescription}</p>
          )}
          <textarea rows={3} value={form.metaDescription} onChange={e => updateForm('metaDescription', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-none ${scraped.metaDescription && scraped.metaDescription !== form.metaDescription ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`}
            placeholder="Skriv din meta description..." />
        </div>
        {/* H1 */}
        <div>
          <label className="text-xs font-bold text-gray-600 uppercase tracking-wide block mb-1.5">H1 Overskrift</label>
          {scraped.h1 && scraped.h1 !== form.h1 && (
            <p className="text-xs text-gray-400 mb-1.5 line-through truncate">{scraped.h1}</p>
          )}
          <input type="text" value={form.h1} onChange={e => updateForm('h1', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition ${scraped.h1 && scraped.h1 !== form.h1 ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`}
            placeholder="Skriv din H1..." />
        </div>
        {/* Body */}
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
          <textarea rows={10} value={form.bodyContent} onChange={e => updateForm('bodyContent', e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition resize-y ${scraped.bodyContent && scraped.bodyContent !== form.bodyContent ? 'border-indigo-200 bg-indigo-50/30' : 'border-gray-200'}`}
            placeholder="Indsæt eller rediger sidens brødtekst..." />
        </div>
        {(scraped.pageTitle || scraped.metaDescription || scraped.h1 || scraped.bodyContent) && (
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {hasChanges ? [
                scraped.pageTitle !== form.pageTitle && 'title',
                scraped.metaDescription !== form.metaDescription && 'meta',
                scraped.h1 !== form.h1 && 'H1',
                scraped.bodyContent !== form.bodyContent && 'indhold',
              ].filter(Boolean).join(', ') + ' ændret' : 'Ingen ændringer'}
            </p>
            <button onClick={() => setForm(prev => ({ ...prev, pageTitle: scraped.pageTitle, metaDescription: scraped.metaDescription, h1: scraped.h1, bodyContent: scraped.bodyContent }))}
              className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold transition">
              ↺ Nulstil til original
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Ahrefs Panel ──────────────────────────────────────────────────────────────
function AhrefsPanel({ data }: { data: AhrefsRow[] }) {
  const cannibal = data.filter(r => r.otherUrls.length > 0)
  const quickWins = data.filter(r => {
    const pos = r.gscPosition || r.prevPosition || 0
    return r.volume > 50 && pos >= 11 && pos <= 40 && r.impressions > 50 && r.ctr < 0.03
  })

  // URL dominance
  const urlCount: Record<string, number> = {}
  data.forEach(r => {
    if (r.primaryUrl) urlCount[r.primaryUrl] = (urlCount[r.primaryUrl] || 0) + 1
  })
  const dominantUrl = Object.entries(urlCount).sort((a, b) => b[1] - a[1])[0]

  const shortUrl = (url: string) => {
    try { return '/' + new URL(url).pathname.split('/').filter(Boolean).slice(-2).join('/') }
    catch { return url.slice(-40) }
  }

  return (
    <div className="space-y-5">
      {/* Kannibalisering */}
      {cannibal.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">⚠️</span>
            <p className="text-xs font-bold tracking-widest uppercase text-red-400">Kannibalisering opdaget</p>
            <span className="ml-auto px-2 py-0.5 bg-red-50 text-red-600 text-xs font-bold rounded-full">{cannibal.length} keywords</span>
          </div>
          <div className="space-y-3">
            {cannibal.map((r, i) => (
              <div key={i} className="p-4 bg-red-50 rounded-xl border border-red-100">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-gray-800">{r.keyword}</span>
                    {r.volume > 0 && <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">{r.volume.toLocaleString()} søgn/md</span>}
                    {(r.gscPosition || r.prevPosition) && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                        Pos {r.gscPosition || r.prevPosition}
                      </span>
                    )}
                  </div>
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex-shrink-0">
                    {r.otherUrls.length + 1} URLs
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full flex-shrink-0"></span>
                    <span className="text-gray-500">Vinder:</span>
                    <span className="font-mono text-gray-700 truncate">{shortUrl(r.primaryUrl)}</span>
                  </div>
                  {r.otherUrls.map((u, j) => (
                    <div key={j} className="flex items-center gap-2 text-xs">
                      <span className="w-2 h-2 bg-red-400 rounded-full flex-shrink-0"></span>
                      <span className="text-gray-500">Kannibaliserer:</span>
                      <span className="font-mono text-gray-600 truncate">{shortUrl(u)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <strong>Anbefaling:</strong> Sæt kanonisk tag på de kannibaliserende sider der peger mod vinderen, eller konsolider indholdet og lav 301-redirects.
          </div>
        </div>
      )}

      {/* Quick Wins */}
      {quickWins.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🎯</span>
            <p className="text-xs font-bold tracking-widest uppercase text-emerald-500">Quick Wins – lavthængende frugt</p>
            <span className="ml-auto px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs font-bold rounded-full">{quickWins.length} keywords</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">Høj søgevolumen · Position 11–40 · Mange visninger · Lav CTR</p>
          <div className="space-y-2">
            {quickWins.map((r, i) => {
              const pos = r.gscPosition || r.prevPosition || 0
              return (
                <div key={i} className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div>
                    <span className="font-semibold text-sm text-gray-800">{r.keyword}</span>
                    <div className="flex gap-3 mt-1">
                      <span className="text-xs text-gray-500">{r.volume} søgn/md</span>
                      <span className="text-xs text-gray-500">{r.impressions.toLocaleString()} visninger</span>
                      <span className="text-xs text-red-500">CTR {(r.ctr * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`text-lg font-bold tabular-nums ${pos <= 20 ? 'text-amber-600' : 'text-red-500'}`}>#{pos}</span>
                    <p className="text-xs text-gray-400">position</p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
            <strong>Anbefaling:</strong> Forbedring fra position 20 til top 10 kan give 5–10× flere klik uden ny linkbuilding. Fokus: title, meta og indholdsdybde.
          </div>
        </div>
      )}

      {/* URL Dominans */}
      {dominantUrl && dominantUrl[1] >= 4 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">🔍</span>
            <p className="text-xs font-bold tracking-widest uppercase text-purple-400">URL-dominans</p>
          </div>
          <p className="text-sm text-gray-700 mb-2">
            Én URL ranker for <strong>{dominantUrl[1]} ud af {data.length}</strong> keywords i dit datasæt:
          </p>
          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg font-mono text-xs text-purple-800 break-all">
            {dominantUrl[0]}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Dette kan indikere at siden overtager for mange keywords fra andre sider. Overvej om keyword-ansvaret er korrekt fordelt i din sitestruktur.
          </p>
        </div>
      )}

      {/* Alle keywords tabel */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up">
        <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Alle Keywords – Overblik</p>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-gray-100">
                {['Keyword', 'Volume', 'Ahrefs pos.', 'GSC pos.', 'Visninger', 'CTR', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => {
                const pos = r.prevPosition || r.currPosition
                const isCannibal = r.otherUrls.length > 0
                const posColor = !pos ? 'text-gray-300' : pos <= 3 ? 'text-emerald-600' : pos <= 10 ? 'text-amber-600' : 'text-red-500'
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition">
                    <td className="py-3 px-3 font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        {r.keyword}
                        {isCannibal && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">⚡ kannibal</span>}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-gray-600 tabular-nums">{r.volume > 0 ? r.volume.toLocaleString() : '–'}</td>
                    <td className={`py-3 px-3 font-bold tabular-nums ${posColor}`}>{pos ? `#${pos}` : '–'}</td>
                    <td className="py-3 px-3 text-gray-600 tabular-nums">{r.gscPosition ? `#${r.gscPosition.toFixed(0)}` : '–'}</td>
                    <td className="py-3 px-3 text-gray-600 tabular-nums">{r.impressions > 0 ? r.impressions.toLocaleString() : '–'}</td>
                    <td className="py-3 px-3 text-gray-600 tabular-nums">{r.impressions > 0 ? `${(r.ctr * 100).toFixed(1)}%` : '–'}</td>
                    <td className="py-3 px-3">
                      {r.currPosition && r.posChange ? (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${r.posChange > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                          {r.posChange > 0 ? `▲ +${r.posChange}` : `▼ ${r.posChange}`}
                        </span>
                      ) : <span className="text-xs text-gray-300">–</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
  const [ahrefsData, setAhrefsData] = useState<AhrefsRow[]>([])
  const [ahrefsFileName, setAhrefsFileName] = useState('')
  const [competitorAnalysis, setCompetitorAnalysis] = useState<{url: string, result: SeoResult}[]>([])
  const [analyzingCompetitor, setAnalyzingCompetitor] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activePanel, setActivePanel] = useState<'dashboard' | 'ahrefs'>('dashboard')

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
      structuredDataTypes: form.structuredDataTypes,
    }
    setResult(analyzeSeo(input))
  }, [form])

  // Recalculate originalResult when keywords or scraped changes
  useEffect(() => {
    if (!form.targetKeyword || !scraped.pageTitle) return
    const origInput: SeoInput = {
      url: form.url, competitorUrls: [],
      targetKeyword: form.targetKeyword.trim(),
      semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
      pageTitle: scraped.pageTitle, metaDescription: scraped.metaDescription,
      h1: scraped.h1, bodyContent: scraped.bodyContent,
      structuredDataTypes: form.structuredDataTypes,
    }
    setOriginalResult(analyzeSeo(origInput))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.targetKeyword, form.semanticKeywords, scraped, form.structuredDataTypes])

  const updateForm = useCallback((key: keyof FormState, val: string) => {
    setForm(prev => ({ ...prev, [key]: val }))
  }, [])

  const handleScrape = useCallback(async () => {
    if (!form.url) return
    setScraping(true); setScrapeError('')
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setScrapeError(data.error ?? 'Scraping fejlede'); return }
      const newTitle = data.title || ''
      const newMeta = data.description || ''
      const newH1 = data.h1 || ''
      const newBody = data.bodyContent || ''
      setScraped({ pageTitle: newTitle, metaDescription: newMeta, h1: newH1, bodyContent: newBody })
      setForm(prev => ({ ...prev, pageTitle: newTitle || prev.pageTitle, metaDescription: newMeta || prev.metaDescription, h1: newH1 || prev.h1, bodyContent: newBody || prev.bodyContent }))
      if (form.targetKeyword) {
        const origInput: SeoInput = {
          url: form.url, competitorUrls: [],
          targetKeyword: form.targetKeyword.trim(),
          semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
          pageTitle: newTitle, metaDescription: newMeta, h1: newH1, bodyContent: newBody,
          structuredDataTypes: form.structuredDataTypes,
        }
        setOriginalResult(analyzeSeo(origInput))
      }
    } catch { setScrapeError('Netværksfejl – tjek din forbindelse') }
    finally { setScraping(false) }
  }, [form.url, form.targetKeyword, form.semanticKeywords, form.structuredDataTypes])

  const handleGscUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setGscFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target?.result as string
      const lines = text.split('\n').filter(Boolean)
      const data: GscData[] = []
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim().replace(/"/g, ''))
        if (parts.length >= 4) data.push({ keyword: parts[0], impressions: parseInt(parts[1]) || 0, clicks: parseInt(parts[2]) || 0, position: parseFloat(parts[3]) || 0 })
      }
      setGscData(data)
    }
    reader.readAsText(file)
  }, [])

  // Parse Ahrefs+GSC Excel file using SheetJS in browser
  const handleAhrefsUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setAhrefsFileName(file.name)
    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        // Dynamically import SheetJS
        const XLSX = await import('xlsx')
        const wb = XLSX.read(evt.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][]

        // Row 0 = source labels (AHREFS / GSC), Row 1 = column headers, Row 2+ = data
        const rows: AhrefsRow[] = []
        for (let i = 2; i < raw.length; i++) {
          const r = raw[i]
          if (!r[0]) continue
          const otherRaw = r[6] ? String(r[6]).split('\n').map((s: string) => s.trim()).filter((s: string) => s.startsWith('http')) : []
          rows.push({
            keyword: String(r[0]),
            prevPosition: r[1] != null ? Number(r[1]) : null,
            currPosition: r[2] != null ? Number(r[2]) : null,
            posChange: r[3] != null ? Number(r[3]) : null,
            volume: r[4] != null ? Number(r[4]) : 0,
            primaryUrl: r[5] ? String(r[5]) : '',
            otherUrls: otherRaw,
            clicks: r[7] != null ? Number(r[7]) : 0,
            impressions: r[8] != null ? Number(r[8]) : 0,
            ctr: r[9] != null ? Number(r[9]) : 0,
            gscPosition: r[10] != null ? Number(r[10]) : 0,
          })
        }
        setAhrefsData(rows)
        if (rows.length > 0) setActivePanel('ahrefs')
      } catch (err) {
        console.error('Ahrefs parse error:', err)
      }
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const analyzeCompetitor = useCallback(async () => {
    const competitorUrls = form.competitorUrls.split('\n').map(u => u.trim()).filter(Boolean).slice(0, 2)
    if (competitorUrls.length === 0 || !form.targetKeyword) return
    setAnalyzingCompetitor(true)
    try {
      const results = await Promise.all(competitorUrls.map(async (competitorUrl) => {
        try {
          const res = await fetch('/api/scrape', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: competitorUrl }) })
          const data = await res.json()
          if (!res.ok || data.error) return null
          const competitorInput: SeoInput = {
            url: competitorUrl, competitorUrls: [],
            targetKeyword: form.targetKeyword.trim(),
            semanticKeywords: form.semanticKeywords.split(',').map(s => s.trim()).filter(Boolean),
            pageTitle: data.title || '', metaDescription: data.description || '',
            h1: data.h1 || '', bodyContent: data.bodyContent || '',
          }
          return { url: competitorUrl, result: analyzeSeo(competitorInput) }
        } catch { return null }
      }))
      setCompetitorAnalysis(results.filter(Boolean) as {url: string, result: SeoResult}[])
    } catch { } finally { setAnalyzingCompetitor(false) }
  }, [form.competitorUrls, form.targetKeyword, form.semanticKeywords])

  const pct = result?.percentage ?? 0

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f2f5', fontFamily: 'Inter, sans-serif' }}>
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-50 shadow-sm">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: '#4f7fff', color: '#fff' }}>S</div>
            <span className="font-semibold text-sm text-gray-800">SEO Dashboard</span>
            {ahrefsData.length > 0 && (
              <div className="flex items-center gap-1 ml-2">
                <button onClick={() => setActivePanel('dashboard')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${activePanel === 'dashboard' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
                  Dashboard
                </button>
                <button onClick={() => setActivePanel('ahrefs')}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${activePanel === 'ahrefs' ? 'bg-purple-100 text-purple-700' : 'text-gray-500 hover:bg-gray-100'}`}>
                  Ahrefs analyse {ahrefsData.filter(r => r.otherUrls.length > 0).length > 0 && <span className="ml-1 bg-red-100 text-red-600 px-1 rounded">⚡{ahrefsData.filter(r => r.otherUrls.length > 0).length}</span>}
                </button>
              </div>
            )}
          </div>
          {result && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-bold tabular-nums ${pct >= 70 ? 'text-emerald-600' : pct >= 45 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</span>
                {originalResult && pct !== originalResult.percentage && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${pct > originalResult.percentage ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                    {pct > originalResult.percentage ? '▲' : '▼'} {Math.abs(pct - originalResult.percentage)}%
                  </span>
                )}
                <span className="text-gray-400 text-xs">SEO Score</span>
              </div>
              <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition">
                {sidebarCollapsed ? '← Vis indstillinger' : 'Skjul indstillinger →'}
              </button>
            </div>
          )}
        </div>
      </nav>

      <div className="flex-1 flex overflow-hidden">
        {/* LEFT SIDEBAR */}
        <div className={`${sidebarCollapsed ? 'w-0' : 'w-full lg:w-[40%]'} overflow-y-auto border-r border-gray-200 bg-white transition-all duration-300`}>
          <div className={`${sidebarCollapsed ? 'hidden' : 'block'} p-6 space-y-6`}>

            {/* URL + Scrape */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">URL & Automatisk Hentning</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="url" placeholder="https://www.hounisen.com/nitrilhandsker" value={form.url}
                  onChange={e => updateForm('url', e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition"
                  style={{ fontFamily: 'Inter, monospace' }} />
                <button onClick={handleScrape} disabled={!form.url || scraping}
                  className="px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50 active:scale-95"
                  style={{ background: scraping ? '#94a3b8' : '#4f7fff' }}>
                  {scraping ? <span className="flex items-center gap-2"><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Henter...</span> : '🔍 Scrape side'}
                </button>
                <button onClick={() => { if (confirm('Ryd alle felter og start forfra?')) { setForm({ ...DEFAULT_FORM }); setScraped({ pageTitle: '', metaDescription: '', h1: '', bodyContent: '' }); setOriginalResult(null); setGscData([]); setGscFileName(''); setAhrefsData([]); setAhrefsFileName(''); setCompetitorAnalysis([]); setScrapeError(''); setActivePanel('dashboard') } }}
                  className="px-5 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold transition-all active:scale-95">
                  🗑️ Ryd alt
                </button>
              </div>
              {scrapeError && <p className="mt-2 text-xs text-red-500 flex items-center gap-1"><span>⚠</span>{scrapeError}</p>}
              <div className="mt-4">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Konkurrent URLs (én pr. linje)</label>
                <textarea rows={2} placeholder="https://www.konkurrent.dk/nitrilhandsker" value={form.competitorUrls}
                  onChange={e => updateForm('competitorUrls', e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none"
                  style={{ fontFamily: 'Inter, monospace' }} />
                {form.competitorUrls && form.targetKeyword && (
                  <button onClick={analyzeCompetitor} disabled={analyzingCompetitor}
                    className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-50"
                    style={{ background: analyzingCompetitor ? '#94a3b8' : '#7c5cff' }}>
                    {analyzingCompetitor ? 'Analyserer...' : '🔍 Analysér konkurrent'}
                  </button>
                )}
              </div>
            </div>

            {/* Keywords */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Keywords</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Target keyword <span className="text-red-400">*</span></label>
                  <input type="text" placeholder="f.eks. nitrilhandsker" value={form.targetKeyword}
                    onChange={e => updateForm('targetKeyword', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Semantiske keywords <span className="text-gray-300">(kommasepareret)</span></label>
                  <textarea rows={3} placeholder="pudderfri nitrilhandsker, latexallergi, engangshandsker" value={form.semanticKeywords}
                    onChange={e => updateForm('semanticKeywords', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Custom keyword-kombinationer <span className="text-gray-300">(kommasepareret)</span></label>
                  <textarea rows={2} placeholder="køb nitrilhandsker, nitrilhandsker tilbud" value={form.customKeywords}
                    onChange={e => updateForm('customKeywords', e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition resize-none" />
                  <p className="text-xs text-gray-400 mt-1.5">Varianter af dit primære keyword der scores separat</p>
                </div>

                {/* Structured Data */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-2">
                    Structured Data / JSON-LD <span className="text-gray-300">(markér hvad siden har)</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {SCHEMA_TYPES.map(schema => {
                      const isChecked = form.structuredDataTypes.includes(schema.id)
                      return (
                        <button key={schema.id} type="button"
                          onClick={() => setForm(prev => ({ ...prev, structuredDataTypes: isChecked ? prev.structuredDataTypes.filter(t => t !== schema.id) : [...prev.structuredDataTypes, schema.id] }))}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all text-left ${isChecked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'}`}>
                          <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${isChecked ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'}`}>
                            {isChecked && <span className="text-white text-xs leading-none">✓</span>}
                          </span>
                          <span>{schema.icon} {schema.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  {form.structuredDataTypes.length > 0 && (
                    <p className="text-xs text-emerald-600 mt-2 font-medium">✓ {form.structuredDataTypes.join(', ')} – tæller med i scoren</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1.5">
                    Tjek via <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Google Rich Results Test</a>
                  </p>
                </div>

                {/* GSC Upload */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">Google Search Console data <span className="text-gray-300">(valgfri CSV)</span></label>
                  <input type="file" accept=".csv" onChange={handleGscUpload} className="hidden" id="gsc-upload" />
                  <label htmlFor="gsc-upload" className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition cursor-pointer">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    {gscFileName || 'Upload GSC CSV (keyword, impressions, clicks, position)'}
                  </label>
                  {gscData.length > 0 && <p className="text-xs text-green-600 mt-1.5 font-medium">✓ {gscData.length} keywords indlæst fra GSC</p>}
                </div>

                {/* Ahrefs Upload */}
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">
                    Ahrefs + GSC analyse <span className="text-gray-300">(Excel .xlsx)</span>
                  </label>
                  <input type="file" accept=".xlsx" onChange={handleAhrefsUpload} className="hidden" id="ahrefs-upload" />
                  <label htmlFor="ahrefs-upload" className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-purple-200 text-sm text-purple-500 hover:border-purple-400 hover:text-purple-700 transition cursor-pointer">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    {ahrefsFileName || 'Upload Ahrefs+GSC Excel (kannibalisering m.m.)'}
                  </label>
                  {ahrefsData.length > 0 && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <p className="text-xs text-purple-600 font-medium">✓ {ahrefsData.length} keywords indlæst</p>
                      {ahrefsData.filter(r => r.otherUrls.length > 0).length > 0 && (
                        <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">
                          ⚡ {ahrefsData.filter(r => r.otherUrls.length > 0).length} kannibaliseringer
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Meta Tags preview */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">Meta Tags</h2>
              <p className="text-xs text-gray-400 mb-4">Rediger i <span className="font-semibold text-indigo-500">Live Editor</span> til højre</p>
              <div className="space-y-3 opacity-60 pointer-events-none">
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Title Tag</span><span className="text-xs font-normal tabular-nums text-gray-400">{form.pageTitle.length}/65</span>
                  </label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 truncate min-h-[42px]">
                    {form.pageTitle || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Meta Description</span><span className="text-xs font-normal tabular-nums text-gray-400">{form.metaDescription.length}/160</span>
                  </label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 line-clamp-2 min-h-[42px]">
                    {form.metaDescription || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Sideindhold preview */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">Sideindhold</h2>
              <p className="text-xs text-gray-400 mb-4">Rediger i <span className="font-semibold text-indigo-500">Live Editor</span> til højre</p>
              <div className="space-y-3 opacity-60 pointer-events-none">
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1.5">H1 Overskrift</label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 truncate min-h-[42px]">
                    {form.h1 || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 flex items-center justify-between mb-1.5">
                    <span>Brødtekst</span>
                    <span className="text-xs font-normal tabular-nums text-gray-400">{result?.wordCount ?? form.bodyContent.split(/\s+/).filter(Boolean).length} ord</span>
                  </label>
                  <div className="w-full px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-500 line-clamp-3 min-h-[60px]">
                    {form.bodyContent || <span className="italic text-gray-300">tom</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
          <div className="max-w-5xl mx-auto space-y-5">

            {/* Ahrefs panel */}
            {activePanel === 'ahrefs' && ahrefsData.length > 0 && (
              <AhrefsPanel data={ahrefsData} />
            )}

            {/* Main dashboard panel */}
            {activePanel === 'dashboard' && (
              <>
                {!result ? (
                  <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
                    {(scraped.pageTitle || scraped.bodyContent) && !form.targetKeyword ? (
                      <>
                        <div className="text-3xl mb-3">✅</div>
                        <p className="text-gray-700 text-sm font-semibold mb-1">Side scraped – mangler kun target keyword</p>
                        <p className="text-gray-400 text-xs">Udfyld <span className="font-semibold text-blue-500">Target keyword</span> i venstre side for at se analysen</p>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-400 text-sm">Udfyld target keyword og scrape URL for at se analysen.</p>
                        <p className="text-gray-500 text-xs mt-2">Resultaterne vises live her mens du ændrer indstillinger ←</p>
                      </>
                    )}
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
                            <span className="text-xs text-gray-500"><span className="font-semibold text-emerald-600">{result.keywordsFound}</span> god</span>
                            <span className="text-xs text-gray-500"><span className="font-semibold text-amber-600">{result.keywordsOptimise}</span> optimer</span>
                            <span className="text-xs text-gray-500"><span className="font-semibold text-red-500">{result.keywordsMissing}</span> mangler</span>
                            <span className="text-xs text-gray-500"><span className="font-semibold text-gray-700">{result.wordCount}</span> ord</span>
                          </div>
                        </div>
                      </div>
                      {form.url && <p className="mt-3 text-xs text-gray-400 font-mono truncate">URL: {form.url}</p>}
                    </div>

                    {/* Live Editor */}
                    <LiveEditor scraped={scraped} form={form} updateForm={updateForm} setForm={setForm} result={result} originalResult={originalResult} />

                    {/* Competitor comparison */}
                    {competitorAnalysis.length > 0 && (
                      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-1">
                        <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Konkurrent-Sammenligning</p>
                        <div className="overflow-x-auto -mx-2 mb-6">
                          <table className="w-full text-sm min-w-[600px]">
                            <thead>
                              <tr className="border-b-2 border-gray-200">
                                <th className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">Metrik</th>
                                <th className="text-center text-xs font-bold tracking-widest uppercase text-blue-600 pb-3 px-3">Din Side</th>
                                {competitorAnalysis.map((_, i) => <th key={i} className="text-center text-xs font-bold tracking-widest uppercase text-gray-600 pb-3 px-3">Konkurrent {i+1}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="border-b border-gray-100">
                                <td className="py-3 px-3 text-gray-600 font-medium">Ordantal</td>
                                <td className="py-3 px-3 text-center"><span className={`font-bold ${(result?.wordCount||0) >= Math.max(...competitorAnalysis.map(c=>c.result.wordCount)) ? 'text-emerald-600' : 'text-amber-600'}`}>{result?.wordCount||0}</span></td>
                                {competitorAnalysis.map((comp,i) => <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold">{comp.result.wordCount}</td>)}
                              </tr>
                              <tr className="border-b border-gray-100">
                                <td className="py-3 px-3 text-gray-600 font-medium">Main keyword<div className="text-xs text-gray-400 font-normal">antal gange nævnt</div></td>
                                <td className="py-3 px-3 text-center"><span className={`font-bold tabular-nums ${(result?.targetKeywordCount||0)>=5?'text-emerald-600':(result?.targetKeywordCount||0)>=2?'text-amber-600':'text-red-500'}`}>{result?.targetKeywordCount||0}×</span></td>
                                {competitorAnalysis.map((comp,i) => <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold tabular-nums">{comp.result.targetKeywordCount}×</td>)}
                              </tr>
                              {(result?.semanticKeywordsTotal||0) > 0 && (
                                <tr className="border-b border-gray-100">
                                  <td className="py-3 px-3 text-gray-600 font-medium">Semantiske keywords<div className="text-xs text-gray-400 font-normal">dækket af total</div></td>
                                  <td className="py-3 px-3 text-center"><span className={`font-bold tabular-nums ${(result?.semanticKeywordsCovered||0)===(result?.semanticKeywordsTotal||1)?'text-emerald-600':(result?.semanticKeywordsCovered||0)>0?'text-amber-600':'text-red-500'}`}>{result?.semanticKeywordsCovered||0}/{result?.semanticKeywordsTotal||0}</span></td>
                                  {competitorAnalysis.map((comp,i) => <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold tabular-nums">{comp.result.semanticKeywordsCovered}/{comp.result.semanticKeywordsTotal}</td>)}
                                </tr>
                              )}
                              <tr className="border-b border-gray-100">
                                <td className="py-3 px-3 text-gray-600 font-medium">Readability</td>
                                <td className="py-3 px-3 text-center font-bold text-gray-800">{result?.readabilityScore||'Medium'}</td>
                                {competitorAnalysis.map((comp,i) => <td key={i} className="py-3 px-3 text-center text-gray-700 font-semibold">{comp.result.readabilityScore}</td>)}
                              </tr>
                              <tr>
                                <td className="py-3 px-3 text-gray-600 font-medium">SEO Score</td>
                                <td className="py-3 px-3 text-center"><span className={`text-2xl font-bold ${pct>=Math.max(...competitorAnalysis.map(c=>c.result.percentage))?'text-emerald-600':'text-amber-600'}`}>{pct}%</span></td>
                                {competitorAnalysis.map((comp,i) => <td key={i} className="py-3 px-3 text-center text-gray-700 text-2xl font-bold">{comp.result.percentage}%</td>)}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                          <div className="font-semibold text-blue-900 mb-2">📊 Nøgleindsigter:</div>
                          <ul className="text-blue-800 space-y-1.5 ml-4 list-disc">
                            {(() => {
                              const maxWC = Math.max(...competitorAnalysis.map(c=>c.result.wordCount))
                              const maxKW = Math.max(...competitorAnalysis.map(c=>c.result.keywordsFound))
                              const maxScore = Math.max(...competitorAnalysis.map(c=>c.result.percentage))
                              return (<>
                                {maxWC>(result?.wordCount||0)&&<li>Top konkurrent har <strong>{maxWC-(result?.wordCount||0)} flere ord</strong></li>}
                                {(result?.wordCount||0)>maxWC&&<li className="text-emerald-700"><strong>✓ Du har dybere indhold</strong> med {(result?.wordCount||0)-maxWC} flere ord</li>}
                                {pct>maxScore?<li className="text-emerald-700"><strong>✓ Du ligger foran!</strong> {pct-maxScore} point højere</li>:pct<maxScore&&<li>Top konkurrent scorer <strong>{maxScore-pct} point højere</strong></li>}
                              </>)
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
                            <button onClick={() => setOpenRec(openRec === rec.id ? null : rec.id)}
                              className="w-full text-left flex items-center justify-between p-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition border border-transparent hover:border-gray-200">
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

                    {/* Keyword table */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-2">
                      <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Keyword Status</p>
                      <div className="flex flex-wrap gap-2 mb-6">
                        {result.keywords.map(k => (
                          <span key={k.keyword} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-transform hover:scale-105 ${k.status==='God'?'bg-emerald-50 text-emerald-700':k.status==='Optimer'?'bg-amber-50 text-amber-700 border border-amber-200':'bg-red-50 text-red-600 border border-red-200'}`}>
                            {k.keyword}
                            {k.status==='God'&&<span className="text-emerald-500">✓</span>}
                            {k.currentCount>0&&k.status!=='God'&&<span className="bg-black/10 rounded-full px-1.5">{k.currentCount}×</span>}
                          </span>
                        ))}
                      </div>
                      <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-sm min-w-[480px]">
                          <thead>
                            <tr className="border-b border-gray-100">
                              {['Keyword','Status','Anbefalet','Nuværende'].map(h=><th key={h} className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {result.keywords.map(k=>(
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
                                {['Keyword','Clicks','Impressions','Position','På siden?'].map(h=><th key={h} className="text-left text-xs font-bold tracking-widest uppercase text-gray-400 pb-3 px-3">{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {gscData.slice(0,10).map((row,i)=>{
                                const text=[form.pageTitle,form.metaDescription,form.h1,form.bodyContent].join(' ').toLowerCase()
                                const onPage=text.includes(row.keyword.toLowerCase())
                                return (
                                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition">
                                    <td className="py-3 px-3 font-medium text-gray-800">{row.keyword}</td>
                                    <td className="py-3 px-3 text-gray-600 tabular-nums">{row.clicks.toLocaleString()}</td>
                                    <td className="py-3 px-3 text-gray-600 tabular-nums">{row.impressions.toLocaleString()}</td>
                                    <td className="py-3 px-3 text-gray-600 tabular-nums">{row.position.toFixed(1)}</td>
                                    <td className="py-3 px-3">{onPage?<span className="text-emerald-600 text-xs font-semibold">✓ Ja</span>:<span className="text-red-500 text-xs font-semibold">✗ Nej</span>}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        {gscData.length>10&&<p className="text-xs text-gray-400 mt-3">Viser top 10 af {gscData.length} keywords</p>}
                      </div>
                    )}

                    {/* Content gaps */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-3">
                      <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Content Gap Analyse</p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {result.contentGaps.map(gap=>(
                          <div key={gap.num} className="bg-gray-50 rounded-xl p-5 hover:shadow-md transition-all hover:-translate-y-0.5" style={{borderTop:`3px solid ${gap.color}`}}>
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
                        {result.quickWins.map((w,i)=>(
                          <div key={i} className="flex items-start gap-3 p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition border border-transparent hover:border-gray-200">
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1.5 ${w.priority==='red'?'bg-red-400':w.priority==='yellow'?'bg-amber-400':'bg-emerald-400'}`} />
                            <div>
                              <div className="font-semibold text-sm text-gray-800 mb-0.5">{w.title}</div>
                              <div className="text-xs text-gray-500 leading-relaxed">{w.detail}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Keyword sections */}
                    {(() => {
                      const optimizeKws = result.keywords.filter(k=>k.status==='Optimer')
                      const missingKws = result.keywords.filter(k=>k.status==='Mangler')
                      const customKwArr = form.customKeywords.split(',').map(k=>k.trim()).filter(Boolean)
                      return (<>
                        {optimizeKws.length>0&&(
                          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-5">
                            <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Use These Keywords More</p>
                            <div className="flex flex-wrap gap-2">
                              {optimizeKws.map((kw,i)=>(
                                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  {kw.keyword}<span className="text-amber-500">({kw.currentCount})</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {missingKws.length>0&&(
                          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-6">
                            <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Consider Semantic Rich Keywords</p>
                            <div className="flex flex-wrap gap-2">
                              {missingKws.map((kw,i)=>(
                                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 border border-red-200">{kw.keyword}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {customKwArr.length>0&&(
                          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-fade-up-7">
                            <p className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-4">Custom Keywords</p>
                            <div className="flex flex-wrap gap-2">
                              {customKwArr.map((kw,i)=>{
                                const text=[form.pageTitle,form.metaDescription,form.h1,form.bodyContent].join(' ').toLowerCase()
                                const nm=kw.toLowerCase().trim().replace(/\s+/g,'\\s*')
                                const found=(text.match(new RegExp(nm,'g'))||[]).length>0
                                return (
                                  <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${found?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-600 border border-red-200'}`}>
                                    {kw}{found&&<span className="text-emerald-500">✓</span>}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </>)
                    })()}
                  </>
                )}
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
