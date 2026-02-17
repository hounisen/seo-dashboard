# SEO Dashboard

Live SEO analyse og optimering af landingpages – bygget med Next.js, Tailwind CSS og Firecrawl.

## Funktioner

- **Automatisk scraping** via Firecrawl API – indsæt en URL, og siden hentes automatisk
- **Live SEO score** der opdaterer sig i realtid mens du redigerer
- **Keyword frekvens tabel** med status: Mangler / Optimer / God
- **Content gap analyse** – hvad konkurrenter dækker, men din side ikke gør
- **Quick wins** sorteret efter prioritet
- **Tegntæller** på title tag og meta description

---

## 🚀 Deploy: Trin-for-trin guide

### Trin 1: Hent din Firecrawl API nøgle

1. Gå til [https://firecrawl.dev](https://firecrawl.dev) og opret en konto
2. Kopiér din API nøgle fra dashboardet

---

### Trin 2: Upload til GitHub

1. Gå til [github.com/new](https://github.com/new)
2. Opret et nyt repository – f.eks. `seo-dashboard`
3. Vælg **Private** (anbefalet, da koden indeholder API-logik)
4. Klik **Create repository**

Kør derefter i din terminal (efter at have pakket ud):

```bash
cd seo-dashboard
git init
git add .
git commit -m "Initial commit – SEO Dashboard"
git branch -M main
git remote add origin https://github.com/DIT-BRUGERNAVN/seo-dashboard.git
git push -u origin main
```

---

### Trin 3: Deploy på Vercel

1. Gå til [vercel.com](https://vercel.com) og log ind
2. Klik **"Add New Project"**
3. Vælg dit `seo-dashboard` repository fra GitHub
4. Vercel auto-detekterer Next.js – klik blot **Deploy**

**Vigtigt – tilføj environment variable:**

5. I Vercel → dit projekt → **Settings → Environment Variables**
6. Tilføj:
   - **Name:** `FIRECRAWL_API_KEY`
   - **Value:** din Firecrawl API nøgle
   - **Environment:** Production + Preview + Development
7. Klik **Save** og **Redeploy**

---

### Trin 4: Lokal udvikling

```bash
# Installér dependencies
npm install

# Opret .env.local
cp .env.example .env.local
# Redigér .env.local og indsæt din FIRECRAWL_API_KEY

# Start dev server
npm run dev
```

Åbn [http://localhost:3000](http://localhost:3000)

---

## Projektstruktur

```
seo-dashboard/
├── src/
│   ├── app/
│   │   ├── page.tsx          ← Hele dashboard UI
│   │   ├── layout.tsx        ← Root layout
│   │   ├── globals.css       ← Global styles
│   │   └── api/
│   │       └── scrape/
│   │           └── route.ts  ← Firecrawl scraping endpoint
│   └── lib/
│       └── seoEngine.ts      ← Regel-baseret SEO analyse engine
├── .env.example
├── next.config.js
├── tailwind.config.js
└── package.json
```

---

## Tilpasning

### Tilføj egne scoring-regler

Redigér `src/lib/seoEngine.ts` – hver scoring-komponent er klart kommenteret:

```typescript
// 4. Content length (20 pts)
if (wordCount >= 800) score += 20
else if (wordCount >= 500) score += 14
// ...
```

### Skift branding

Redigér farver og navn i `src/app/page.tsx` – se `style={{ background: '#4f7fff' }}` osv.

---

## Tech stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS**
- **Firecrawl API** (scraping)
- **Vercel** (hosting)
