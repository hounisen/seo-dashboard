// lib/cleanContent.ts
// Trimmer scrapet markdown, så kun reelt sideindhold tæller i scoringen.

export function cleanMetaDescription(raw: string): string {
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

export function cleanMarkdown(md: string): string {
  let lines = md.split('\n')
  // Alt før første H1 er skabelon (tilbage-links, forfatterbokse, "Om ...") – fjernes, hvis H1 findes tidligt
  const h1Idx = lines.findIndex(l => /^#\s+\S/.test(l.trim()))
  if (h1Idx > 0 && h1Idx <= 40) lines = lines.slice(h1Idx)
  const cleaned: string[] = []
  let skipBlock = false
  let skipUntil = false
  let skipProductCard = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()

    // Instagram-embeds
    if (/^\[hoteloasia\]|^\[View Instagram|instagram\.com\/p\/|instagram\.com\/reel\//.test(t)) skipBlock = true
    if (skipBlock) {
      if (/^#{1,3}\s/.test(t) && !/instagram|hoteloasia/i.test(t)) skipBlock = false
      else continue
    }

    // Nyhedsbrev-blok (springes til næste overskrift – eller til slutningen)
    if (/bliv en del af|tilmeld.*nyhedsbrev|få nyheder.*eksklusive|afmelde dig nyhedsbrevet/i.test(t)) skipUntil = true
    if (skipUntil) {
      if (/^#{1,3}\s/.test(t) && !/bliv en del af|nyhedsbrev/i.test(t)) skipUntil = false
      else continue
    }

    // Produktkort: "#### [Produktnavn](...)" og alt til næste H1–H3
    if (/^#{4,6}\s*\[.+\]\(.+\)/.test(t)) skipProductCard = true
    if (skipProductCard) {
      if (/^#{1,3}\s/.test(t)) skipProductCard = false
      else continue
    }

    // Brødkrumme-lister og menulinks
    if (/^-\s+\[.+?\]\(https?:\/\/.+?\)$/.test(t)) continue
    if (/^-\s+[^\[].{1,60}$/.test(t) && !/[.,:;!?]/.test(t) && i < 10) continue

    // Billeder og billed-URLs
    if (t.startsWith('![') || t.startsWith('[![')) continue
    if (/GetImage\.ashx|\/Files\/Images\/Ecom\//.test(t)) continue

    // Produkt-UI / filtre / lagerstatus
    if (/^\*\*(Varenummer|Varenavn|Måleområde|Lagerstatus|Art\.?nr|Pris|Leveringstid):\*\*/i.test(t)) continue
    if (/^(På lager|Ikke på lager|Udgået|Lavt lager)$/i.test(t)) continue
    if (/^(Vis alle|Vis kun|Sortering|Alfabetisk|Varenummer|Popularitet|Brand[A-Z])/i.test(t)) continue
    if (/\d+\s+produkter?\s+i\s+kategorien/i.test(t)) continue
    if (/^\[(Se produkt|Tilføj til kurv|Køb nu|Log ind|Bliv kunde|Opret|Læs mere)\]/i.test(t)) continue
    if (/for at se priser og købe/i.test(t)) continue
    if (/^\[Log ind\].*\[Bliv kunde\]/i.test(t)) continue

    // Kontaktlinjer og USP-linjer
    if (/^Tlf\.?\s*[\d\s()+-]{6,}$/.test(t)) continue
    if (/^\[.*@.*\]\(mailto:/.test(t)) continue
    if (/^[✓✔●•▸]\s/.test(t) && t.length < 80 && !/[.,:;]$/.test(t)) continue
    if (/^(Dansk support|Dag[- ]til[- ]dag[- ](levering|afsendelse)|Hurtig genbestilling|Faguddannet personale|Fri fragt|Gratis fragt|Sikker betaling)(\s*\(.*\))?$/i.test(t)) continue

    // Forfatterbokse og tilbage-links
    if (/^(Af|Skrevet af|Forfatter|Om forfatteren|Udgivet|Opdateret|Læsetid)\b[:\s]/i.test(t) && t.length < 100) continue
    if (/^\[?\s*[←‹«]\s*(Tilbage|Back)/i.test(t) || /^\[(Tilbage|Back)[^\]]*\]\(/i.test(t)) continue

    // Navigation, social, share
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
