# Job Tracker — Data Sources Reference

Complete reference for all data ingestion sources, filtering criteria, scoring logic, and data flow.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Source Summary](#2-source-summary)
3. [Source Details](#3-source-details)
   - [3.1 Firehose SSE Streams](#31-firehose-sse-streams)
   - [3.2 ATS Direct Polling](#32-ats-direct-polling)
   - [3.3 Mantiks (LinkedIn)](#33-mantiks-linkedin)
   - [3.4 LinkedIn Scraper (npm)](#34-linkedin-scraper-npm)
   - [3.5 LinkedIn Direct (Fallback)](#35-linkedin-direct-fallback)
   - [3.6 SerpApi (Google Jobs)](#36-serpapi-google-jobs)
   - [3.7 HasData — Indeed](#37-hasdata--indeed)
   - [3.8 HasData — Glassdoor](#38-hasdata--glassdoor)
   - [3.9 Supabase Realtime (Frontend)](#39-supabase-realtime-frontend)
4. [Firehose Rules Breakdown](#4-firehose-rules-breakdown)
5. [Shared Firehose Filters](#5-shared-firehose-filters)
6. [Processor Filtering Pipeline](#6-processor-filtering-pipeline)
7. [Scoring System](#7-scoring-system)
8. [Data Flow](#8-data-flow)
9. [Fallback Chain](#9-fallback-chain)
10. [Environment Variables](#10-environment-variables)
11. [Control Server Endpoints](#11-control-server-endpoints)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                                 │
│                                                                      │
│  ┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Firehose    │  │ Mantiks  │  │ LinkedIn │  │  SerpApi         │  │
│  │  SSE (×7)    │  │ API      │  │ Scraper  │  │  Google Jobs     │  │
│  │  Real-time   │  │ Weekly   │  │ 2×/day   │  │  2×/day          │  │
│  └──────┬───────┘  └────┬─────┘  └────┬─────┘  └───────┬──────────┘  │
│         │               │             │                 │            │
│  ┌──────┴───────┐  ┌────┴──────────┐  │  ┌─────────────┴──────────┐ │
│  │ ATS Direct   │  │ HasData       │  │  │ LinkedIn Direct        │ │
│  │ GH/LV/AB/SR  │  │ Indeed + GD   │  │  │ (Emergency fallback)   │ │
│  │ Hourly       │  │ 2×/day        │  │  │ On-demand              │ │
│  └──────┬───────┘  └────┬──────────┘  │  └──────────┬─────────────┘ │
└─────────┼───────────────┼─────────────┼─────────────┼───────────────┘
          │               │             │             │
          ▼               ▼             ▼             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    PROCESSOR  (processor.ts)                          │
│                                                                      │
│  URL normalize → Pre-filters → Dedup → Score → Resume fit → Insert  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (Postgres + Realtime)                     │
│                                                                      │
│  job_postings │ resume_versions │ listener_state │ resumes (storage) │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ WebSocket (Realtime INSERT events)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    FRONTEND  (Next.js)                                │
│                                                                      │
│  Dashboard │ Jobs List │ Job Detail │ Resume │ /api/stats,jobs,poll  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Source Summary

| # | Source | Type | Schedule | Cost | Auth | Env Var | Trigger Path |
|---|--------|------|----------|------|------|---------|-------------|
| 1 | Firehose SSE (7 taps) | Stream | Real-time | Subscription | Bearer token | `FIREHOSE_TAP_TOKEN`..`_7` | — |
| 2 | ATS Direct (GH/LV/AB/SR) | Poll | Hourly | Free (public APIs) | None | — | `POST /poll` |
| 3 | Mantiks (LinkedIn) | Poll | Weekly | ~400 credits/mo (500 budget) | x-api-key | `MANTIKS_API_KEY` | `POST /poll/mantiks` |
| 4 | LinkedIn Scraper (npm) | Poll | 2×/day (6am, 6pm) | Free | None | — | `POST /poll/linkedin` |
| 5 | LinkedIn Direct (fallback) | Poll | Emergency only | Free | None | — | — |
| 6 | SerpApi (Google Jobs) | Poll | 2×/day (6am, 6pm) | Free tier (100/mo) | Query param | `SERPAPI_API_KEY` | `POST /poll/serpapi` |
| 7 | HasData (Indeed) | Poll | 2×/day (6am, 6pm) | 5 credits/req | x-api-key | `HASDATA_API_KEY` | `POST /poll/indeed` |
| 8 | HasData (Glassdoor) | Poll | 2×/day (6am, 6pm) | 5 credits/req | x-api-key | `HASDATA_API_KEY` | `POST /poll/glassdoor` |
| 9 | Supabase Realtime | WebSocket | Always-on | Included | Anon key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — |

---

## 3. Source Details

### 3.1 Firehose SSE Streams

**Files:** `apps/listener/src/rules.ts`, `apps/listener/src/index.ts`

| Detail | Value |
|--------|-------|
| Endpoint | `https://api.firehose.com/v1/stream` |
| Protocol | Server-Sent Events (SSE) |
| Auth | Bearer token per tap |
| Concurrent streams | 7 (one per tap, across 3 Firehose accounts) |
| Reconnect delay | 5 seconds |
| Offset persistence | `listener_state` table (key: `last_event_id:{tap_name}`) |
| Resume | `Last-Event-ID` header on reconnect |
| Total rules | 78 across 7 taps |

**How it works:** Each tap is an independent SSE connection. Events arrive as `update` messages containing a document URL, title, markdown content, and the matched rule's query_id. The processor maps query_id → rule tag via a cached lookup, then passes the event through the full filtering and scoring pipeline.

**Management API:** Rules are synced on startup via `https://api.firehose.com/v1/rules` (GET/POST/PUT/DELETE). Orphaned rules are deleted first to free slots, then missing rules are created and changed rules updated.

**Account distribution:**
- Account 1: Taps 1–3 (`FIREHOSE_MANAGEMENT_KEY`)
- Account 2: Taps 4–5 (`FIREHOSE_MANAGEMENT_KEY_2`)
- Account 3: Taps 6–7 (`FIREHOSE_MANAGEMENT_KEY_3`)

See [Section 4](#4-firehose-rules-breakdown) for the full rules breakdown.

---

### 3.2 ATS Direct Polling

**Files:** `apps/listener/src/ats-poller.ts`, `apps/listener/src/ats-companies.ts`

| Detail | Value |
|--------|-------|
| Schedule | Hourly + on startup |
| Cost | Free (all public APIs) |
| Companies | 236 entries across 3 ATS platforms (Greenhouse, Lever, iCIMS) |
| Timeout | 15 seconds per request |
| Delay | 400ms between companies |
| Auth | None (public endpoints) |
| Trigger | `POST /poll` |

**ATS Endpoints:**

| Platform | API URL | Companies |
|----------|---------|-----------|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | 205 |
| Lever | `https://api.lever.co/v0/postings/{slug}?mode=json` | 30 |
| iCIMS | `https://icims.com` (no public API) | 1 |

**Source-level filtering:** Each job title is checked against design role patterns before insertion:

Included titles: product designer, UX designer, UI/UX, UX/UI, interaction designer, experience designer, design engineer, UI designer, associate designer, junior designer, senior designer, design technologist, UX researcher, user researcher, design lead, UX lead, product design, UX design, user experience designer

Excluded titles: graphic designer, interior designer, fashion designer, instructional designer, game designer, industrial designer

**Company categories in registry:** Revenue/Sales/CRM, Customer Engagement/Support, Analytics/Data, Product/Design Tooling, HR/People Ops, Fintech/Payments, Developer Tools/Infrastructure, Contract/Legal, Productivity/Collaboration, Security/Compliance, DevOps/Infrastructure, Marketing/Growth, Product Adoption/Research, AI/LLM Platforms, Fintech/Spend Management, HR Tech, Vertical SaaS, BI/Analytics, Healthcare/Benefits, AI Healthcare, Semiconductor/Hardware

---

### 3.3 Mantiks (LinkedIn)

**File:** `apps/listener/src/linkedin-mantiks.ts`

| Detail | Value |
|--------|-------|
| Endpoint | `https://api.mantiks.io/company/search` |
| Auth | `x-api-key` header |
| Schedule | Weekly (every 7 days) + on startup |
| Budget | 500 credits/month, 2 credits per lead |
| Usage | ~400 credits/month (4 polls × 50 leads × 2 credits) |
| Trigger | `POST /poll/mantiks` |

**Search parameters:**
- `job_age_in_days`: 7 (aligns with weekly poll — zero overlap between polls)
- `job_board`: linkedin
- `limit`: 50 (no pagination — single page only)
- `job_title`: "product designer", "UX designer", "interaction designer"
- `job_title_excluded`: "senior", "lead", "principal", "staff", "manager", "director", "head of", "vp"
- `job_location_ids`: resolved once on startup via `/location/search?name=United States`

**Credit safety:** Skips insert if `credits_remaining < 50`.

**URL handling:** LinkedIn URLs are canonicalized to `https://www.linkedin.com/jobs/view/{id}` format.

---

### 3.4 LinkedIn Scraper (npm)

**File:** `apps/listener/src/linkedin-scraper.ts`

| Detail | Value |
|--------|-------|
| Library | `linkedin-jobs-api` (npm) |
| Auth | None required |
| Schedule | 2×/day at 6am and 6pm (via `scheduleDailyAt`) |
| Queries | 4 keywords × 4 locations = 16 requests per cycle |
| Trigger | `POST /poll/linkedin` |

**Search queries:**
- Keywords: "product designer B2B", "UX designer enterprise", "product designer AI", "interaction designer SaaS"
- Locations: San Francisco, Seattle, New York, Remote

**Query parameters per request:**
- `dateSincePosted`: "past Week"
- `jobType`: "full time"
- `remoteFilter`: "remote" (for Remote location only)
- `limit`: 25

**Health tracking:** Tracks `consecutiveFailures`. After 3+ consecutive failures, logs a warning that LinkedIn may have changed its frontend. Used by the fallback chain.

---

### 3.5 LinkedIn Direct (Fallback)

**File:** `apps/listener/src/linkedin-direct.ts`

| Detail | Value |
|--------|-------|
| Type | Direct HTML scraping of LinkedIn public pages |
| Auth | None (rotated User-Agent strings) |
| Schedule | Emergency only — activated when Mantiks + scraper both down for 8+ hours AND no SerpApi key |
| Max requests | 10 per invocation |
| Delay | Random 30–120 seconds between requests |
| Trigger | Automatic via fallback chain |

**Search queries:** Same as LinkedIn Scraper (4 keywords × 4 locations)

**Rate limiting:** Respects 429 responses and stops immediately. Uses 4 rotated browser User-Agent strings. Descriptions are marked as `[Incomplete — direct scrape]`.

---

### 3.6 SerpApi (Google Jobs)

**File:** `apps/listener/src/serpapi-jobs.ts`

| Detail | Value |
|--------|-------|
| Endpoint | `https://serpapi.com/search?engine=google_jobs` |
| Auth | `api_key` query parameter |
| Schedule | 2×/day at 6am and 6pm |
| Budget | Free tier: 100 searches/month (~17/month used) |
| Results per query | 10 |
| Trigger | `POST /poll/serpapi` |

**Search queries** (4 total, targeting ATS platforms specifically):
1. `"product designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "enterprise"`
2. `"UX designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com "B2B" OR "SaaS"`
3. `"interaction designer" site:greenhouse.io OR site:lever.co OR site:ashbyhq.com`
4. `"design engineer" site:greenhouse.io OR site:ashbyhq.com OR site:lever.co`

**Coverage gap detection:** For each result, checks if the job URL already exists in the database. If not, logs `[SERPAPI NEW]` — this helps identify jobs that other sources missed.

**URL priority:** Prefers direct ATS links (greenhouse/lever/ashby/smartrecruiters) over LinkedIn links.

---

### 3.7 HasData — Indeed

**File:** `apps/listener/src/hasdata-jobs.ts`

| Detail | Value |
|--------|-------|
| Endpoint | `https://api.hasdata.com/scrape/indeed/listing` |
| Auth | `x-api-key` header |
| Schedule | 2×/day at 6am and 6pm |
| Cost | 5 credits per request, 3 keywords = 15 credits per poll |
| Trigger | `POST /poll/indeed` |

**Search parameters per keyword:**
- `keyword`: "product designer", "UX designer", "interaction designer"
- `location`: "United States"
- `sort`: "date"
- `domain`: "www.indeed.com"

**Source-level filtering:** Requires title to match `/\b(designer|design|UX|UI|interaction|visual|product)\b/i` — blocks sponsored/non-job content.

**Coverage gap detection:** Logs `[INDEED NEW]` for jobs not yet in the database.

---

### 3.8 HasData — Glassdoor

**File:** `apps/listener/src/hasdata-jobs.ts`

| Detail | Value |
|--------|-------|
| Endpoint | `https://api.hasdata.com/scrape/glassdoor/listing` |
| Auth | `x-api-key` header |
| Schedule | 2×/day at 6am and 6pm |
| Cost | 5 credits per request, 3 keywords = 15 credits per poll |
| Trigger | `POST /poll/glassdoor` |

**Search parameters per keyword:**
- `keyword`: "product designer", "UX designer", "interaction designer"
- `location`: "United States"
- `sort`: "recent"
- `domain`: "www.glassdoor.com"

**Source-level filtering:** Same design title regex as Indeed.

**Combined HasData cost:** 30 credits per trigger (6 requests × 5 credits).

---

### 3.9 Supabase Realtime (Frontend)

**Files:** `apps/web/app/page.tsx`, `apps/web/app/jobs/page.tsx`

| Detail | Value |
|--------|-------|
| Protocol | WebSocket (Supabase Realtime channel) |
| Auth | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public) |
| Events | `postgres_changes` → INSERT on `job_postings` table |
| Channels | `job_postings_dashboard` (filtered by priority), `job_postings_list` |

**Dashboard subscription:** Listens for INSERT events, increments a "new jobs" counter badge. Priority filter on the subscription limits to high-priority jobs.

**Jobs list subscription:** Listens for all INSERT events, shows a "N new job(s)" notification button.

---

## 4. Firehose Rules Breakdown

78 rules across 7 taps, organized by purpose.

### Tap 1: "Job Tracker" — Core Search (12 rules)

Account 1 · Token: `FIREHOSE_TAP_TOKEN`

| Tag | Type | Target | Filters |
|-----|------|--------|---------|
| `b2b-core` | Keyword | Design titles + NOT senior/staff/principal/director/VP/manager/8+yr/10+yr | buildRule (NON_US + FP exclusion) |
| `b2b-enterprise` | Keyword | Product/UX designer + B2B/enterprise/SaaS + design system/dashboard/workflow/devtools | buildRule |
| `b2b-ai` | Keyword | Product/UX/AI designer + generative AI/LLM/conversational UI/AI-powered/agentic | buildRule |
| `b2b-newgrad` | Keyword | Product/UX/associate designer + new grad/early career/2026/junior/associate + B2B/AI | buildRule |
| `b2b-target-co` | Keyword | Design titles + 100+ named target companies (Salesforce through Eppo) | buildRule |
| `b2b-tier3` | Keyword | Design titles + Big Tech/finance/consulting (Microsoft, Google, Goldman, etc.) | buildRule |
| `b2b-design-systems` | Keyword | Design technologist/engineer/systems roles + design system/component library/tokens | buildRule |
| `b2b-fintech` | Keyword | Design titles + fintech/payments/banking/lending + B2B/enterprise/SaaS | buildRule |
| `b2b-startup` | Keyword | Design titles + Series A/B/C/YC/a16z/Sequoia + B2B/enterprise/SaaS | buildRule |
| `linkedin-design` | Domain | `linkedin.com/jobs/view/*` + design titles | language:"en" + FP exclusion |
| `linkedin-posts` | Domain | `linkedin.com` (NOT /jobs/) + design titles + hiring language | language:"en" |
| `ats-design` | Domain | greenhouse.io, lever.co, ashbyhq.com, workable.com, wellfound.com + design titles | language:"en" + FP exclusion |

### Tap 2: "Job Tracker Platforms" — Job Boards (6 rules)

Account 1 · Token: `FIREHOSE_TAP_TOKEN_2`

| Tag | Target Domains |
|-----|----------------|
| `glassdoor` | glassdoor.com `/job-listing/*` |
| `indeed` | indeed.com `/viewjob*` |
| `dice` | dice.com `/jobs/*` |
| `builtin` | builtin.com + 8 city subdomains (NYC, LA, SF, Seattle, Austin, Boston, Chicago, Colorado) |
| `remote-boards` | weworkremotely.com, remotive.com, remote.co, flexjobs.com, nodesk.co |
| `design-boards` | dribbble.com, coroflot.com, aiga.org, workingnotworking.com, authenticjobs.com, krop.com |

All rules use `buildDomainRule` (language:"en" + FP exclusion).

### Tap 3: "Job Tracker Signals" — Intelligence (7 rules)

Account 1 · Token: `FIREHOSE_TAP_TOKEN_3`

| Tag | Target | Notes |
|-----|--------|-------|
| `hacker-news` | news.ycombinator.com + design titles + hiring signals | No FP filter |
| `twitter-x` | twitter.com, x.com + design titles + hiring language | No FP filter |
| `wellfound` | wellfound.com + design titles | |
| `vc-jobs` | workatastartup.com, ycombinator.com, jobs.a16z.com, jobs.sequoiacap.com, greylock.com | No FP filter |
| `producthunt` | producthunt.com + design titles + hiring signals | No FP filter |
| `reddit-jobs` | reddit.com (r/forhire, r/UXDesign, r/design, r/userexperience) + hiring signals | language:"en" |
| `company-careers` | Any domain with `/careers/*` + design titles + job posting signals | buildRule |

### Tap 4: "Job Tracker Extended" — ATS & Direct Careers (13 rules)

Account 2 · Token: `FIREHOSE_TAP_TOKEN_4`

| Tag | Target |
|-----|--------|
| `ziprecruiter` | ziprecruiter.com `/jobs/*` |
| `simplyhired` | simplyhired.com |
| `jobvite` | jobs.jobvite.com |
| `smartrecruiters` | jobs.smartrecruiters.com |
| `workday-jobs` | myworkdayjobs.com |
| `icims` | icims.com |
| `taleo` | taleo.net |
| `bamboohr-jobs` | bamboohr.com `/jobs/*` |
| `techjobs` | techjobs.com, cybercoders.com, hired.com |
| `tier1-careers-direct` | careers.salesforce.com, openai.com, stripe.com, careers.atlassian.com, careers.servicenow.com, careers.adobe.com, careers.zoom.us, jobs.cisco.com, careers.datadoghq.com, careers.snowflake.com, jobs.lever.co, careers.twilio.com, jobs.intuit.com, jobs.sap.com, careers.oracle.com |
| `tier2-careers-direct` | canva.com, miro.com, jobs.ashbyhq.com, writer.com, cohere.com, gusto.com, rippling.com, lattice.com, careers.toasttab.com, procore.com, samsara.com, careers.doordash.com, careers.robinhood.com, careers.coinbase.com, careers.airbnb.com, careers.databricks.com |
| `handshake` | joinhandshake.com |

### Tap 5: "Job Tracker Niche" — Communities & Niche Boards (14 rules)

Account 2 · Token: `FIREHOSE_TAP_TOKEN_5`

| Tag | Target |
|-----|--------|
| `substack-jobs` | substack.com + hiring signals |
| `tech-news-hiring` | techcrunch.com, venturebeat.com, theverge.com, wired.com, forbes.com + hiring signals |
| `design-communities` | uxdesign.cc, nngroup.com, smashingmagazine.com, medium.com + hiring signals |
| `angel-co` | angel.co |
| `arc-dev` | arc.dev |
| `jobs-lever-all` | jobs.lever.co |
| `ashby-all` | jobs.ashbyhq.com |
| `rippling-ats` | ats.rippling.com |
| `workable-all` | apply.workable.com |
| `toptal-jobs` | toptal.com |
| `otta-jungle` | welcometothejungle.com, otta.com |
| `simplify-cord` | simplify.jobs, cord.com |
| `behance-ux` | behance.net, uxjobsboard.com, uxdesignjobs.net, designerjobs.co |

### Tap 6: "Job Tracker BigTech" — Big Tech & Fortune 500 (12 rules)

Account 3 · Token: `FIREHOSE_TAP_TOKEN_6`

| Tag | Target Domains |
|-----|----------------|
| `amazon-direct` | amazon.jobs |
| `google-direct` | careers.google.com, careers.googleplex.com |
| `meta-direct` | metacareers.com |
| `apple-direct` | jobs.apple.com |
| `microsoft-direct` | careers.microsoft.com |
| `linkedin-direct` | careers.linkedin.com |
| `chip-hardware` | nvidia.com, amd.com, qualcomm.com, broadcom.com (career pages) |
| `media-social-direct` | jobs.netflix.com, lifeatspotify.com, snap.com, discord.com, duolingo.com |
| `bigbank-direct` | capitalonecareers.com, careers.jpmorgan.com, higher.gs.com, morganstanley.com, americanexpress.com |
| `b2b-custom-careers` | hubspot.com, airtable.com, asana.com, monday.com, amplitude.com |
| `mobility-direct` | tesla.com, waymo.com, uber.com, rivian.com, cruise.com |
| `consulting-design` | deloitte.com, thoughtworks.com, accenture.com, ideo.com, frog.co |

### Tap 7: "Job Tracker Niche2" — More Direct & Niche (14 rules)

Account 3 · Token: `FIREHOSE_TAP_TOKEN_7`

| Tag | Target Domains |
|-----|----------------|
| `ai-labs-direct` | scale.com, cohere.com, mistral.ai, perplexity.ai, huggingface.co |
| `devtools-direct` | github.com, vercel.com, hashicorp.com, getdbt.com, retool.com |
| `data-platform-direct` | databricks.com, snowflake.com, fivetran.com, airbyte.com, dbt.com |
| `collab-creative-direct` | miro.com, canva.com, figma.com, coda.io, loom.com |
| `hris-payroll-direct` | gusto.com, rippling.com, deel.com, lattice.com, greenhouse.io |
| `ecom-direct` | shopify.com, ebay.com, wayfair.com, etsy.com, instacart.com |
| `healthtech-direct` | epic.com, athenahealth.com, veeva.com, teladoc.com, doximity.com |
| `cloud-security-direct` | paloaltonetworks.com, crowdstrike.com, zscaler.com, cloudflare.com, sentinelone.com |
| `fintech-startup-direct` | plaid.com, robinhood.com, coinbase.com, chime.com, affirm.com |
| `gaming-entertain-direct` | roblox.com, unity.com, ea.com, epicgames.com, activision.com |
| `enterprise-legacy-direct` | servicenow.com, zendesk.com, freshworks.com, sap.com, salesforce.com |
| `proptech-retail-direct` | opendoor.com, realpage.com, appfolio.com, walmart.com, target.com |
| `research-platform-direct` | dovetail.com, userinterviews.com, usertesting.com, qualtrics.com, fullstory.com |

---

## 5. Shared Firehose Filters

All keyword-based rules (Tap 1 core rules) apply two shared exclusion filters:

### NON_US_EXCLUSION (keyword rules only)
Appended by `buildRule()`. Blocks events mentioning 30+ non-US locations:

London, United Kingdom, UK, Berlin, Germany, Paris, France, Tokyo, Japan, Singapore, Sydney, Melbourne, Australia, Toronto, Vancouver, Canada, Mumbai, Bangalore, India, Dublin, Ireland, Amsterdam, Netherlands, Stockholm, Sweden, Beijing, Shanghai, China, Seoul, Korea, Tel Aviv, Israel, São Paulo, Brazil, Mexico City

### FP_EXCLUSION (all rules except some signals)
Blocks false-positive design roles and non-full-time work:

graphic designer, interior designer, fashion designer, instructional designer, game designer, industrial designer, freelance, contractor, part-time

### DESIGN_TITLES (shared across all rules)
19 title variants matched:

product designer, UX designer, UI/UX designer, UI designer, interaction designer, experience designer, design engineer, UX/UI designer, associate designer, junior designer, senior designer, design technologist, UX researcher, user researcher, design lead, UX lead, product design, UX design, user experience designer

### buildRule() vs buildDomainRule()

| Function | Location filter | FP filter | Use case |
|----------|----------------|-----------|----------|
| `buildRule(base)` | NON_US_EXCLUSION (keyword blocklist) | FP_EXCLUSION | Keyword-based searches (Tap 1 core rules) |
| `buildDomainRule(base)` | `language:"en"` | FP_EXCLUSION (optional) | Domain-scoped rules (job boards, career pages) |

---

## 6. Processor Filtering Pipeline

All sources call `insertJobPosting()` in `processor.ts`. Events flow through these filters in order:

### Stage 1: Pre-insert Filters (before any DB call)

| # | Filter | What it blocks | Regex/Logic |
|---|--------|----------------|-------------|
| 1 | **Job Board URL allowlist** (Firehose only) | Non-job-board URLs | Must match known hosts (`linkedin.com`, `greenhouse.io`, `lever.co`, etc.), job subdomains (`jobs.`, `careers.`, `apply.`, `work.`), or job paths (`/jobs/`, `/careers/`, `/positions/`, `/openings/`) |
| 2 | **Title blocking** | Senior/lead/staff/intern roles | `/\b(senior\|sr\.?\|lead\|principal\|staff\|intern(ship)?\|scholarship\|researcher\|design\s+engineer)\b/i` |
| 3 | **Location blocking** | Explicit non-US locations | 60+ cities/countries; allows empty, "Remote", "Hybrid", "United States", US state abbreviations |
| 4 | **Company blocking** | Specific companies | Blocklist: `lensa` |
| 5 | **Article detection** | Content marketing / blog posts | Titles starting with "How to", "What is", "Best...", "X tips for", "Guide to", year prefixes; phrases like "business model", "deep dive", "case study" |

### Stage 2: Dedup

- URL is normalized (strip UTM params, trailing slashes)
- SHA-256 hash of normalized URL
- If URL exists in `job_postings.url_hash` → update `last_seen` timestamp, skip insert

### Stage 3: Scoring (via `@job-tracker/scoring`)

- Keyword matching across 6 groups (see [Section 7](#7-scoring-system))
- Company tier bonus (+5/+10/+20)
- Seniority bonus/penalty
- Location bonus/penalty

### Stage 4: Post-score Filters

| # | Filter | What it blocks |
|---|--------|----------------|
| 6 | **Seniority exclusion** | Staff, principal, director, VP, head of design, design manager, manager, lead with 7+yr, 8+yr |
| 7 | **Resume fit filter** | If active resume exists AND resume fit = 0% (zero keyword overlap) → skip |

### Stage 5: Insert

Upsert to `job_postings` table with: URL, url_hash, company, company_tier, title, location, salary_min/max, score, resume_fit, score_breakdown, keywords_matched, firehose_rule (source tag), priority, page_content, first_seen, last_seen, status="new"

---

## 7. Scoring System

**File:** `packages/scoring/src/score.ts`

### Keyword Groups

| Group | Weight | Terms (count) | Examples |
|-------|--------|--------------|----------|
| B2B/Domain | 5 | 27 | B2B, enterprise, SaaS, developer tools, CRM, fintech, dashboard, API, workflow automation |
| AI & Emerging | 4 | 21 | AI-powered, LLM, generative AI, agentic AI, conversational UI, human-in-the-loop, MCP |
| Core Design | 3 | 22 | product designer, UX designer, design systems, prototyping, wireframes, accessibility, WCAG |
| Methods | 2 | 19 | user research, usability testing, A/B testing, journey mapping, 0-to-1, design thinking |
| Soft Skills | 2 | 16 | cross-functional, storytelling, stakeholder alignment, navigate ambiguity, strategic |
| Tools | 1 | 21 | Figma, Framer, HTML, CSS, JavaScript, Miro, Jira, Webflow, Cursor, Claude Code |

Each term match scores `weight × min(hits, 3)` (capped at 3× per term).

### Bonuses

| Category | Condition | Bonus |
|----------|-----------|-------|
| **Company Tier 1** | Pure B2B/Enterprise SaaS (58 companies: Salesforce, Figma, Stripe, etc.) | +20 |
| **Company Tier 2** | Strong Enterprise DNA (85 companies: Anthropic, Brex, Ramp, Linear, etc.) | +10 |
| **Company Tier 3** | B2B-Adjacent / Big Tech (78 companies: Google, Microsoft, Meta, etc.) | +5 |
| **Seniority: New grad** | Title/text matches: new grad, early career, 2026, associate, junior, entry-level | +10 |
| **Seniority: No level** | Title is "Product Designer" / "UX Designer" (exact, no level qualifier) | +5 |
| **Seniority: Senior 7+yr** | Senior with 7+/8+ years | -10 |
| **Location: Remote/SF/SEA** | Remote, Hybrid, SF Bay Area, Seattle metro | +5 |
| **Location: NYC** | New York metro | +3 |
| **Location: Non-US** | 60+ non-US cities/countries | -20 |

### Priority Thresholds

| Priority | Score Range |
|----------|------------|
| High | ≥ 50 |
| Medium | ≥ 30 |
| Low | ≥ 15 |
| Skip | < 15 (or seniority excluded) |

### Resume Fit

`resume_fit = (overlap keywords / posting keywords) × 100`

Where "overlap keywords" are posting-matched keywords that also appear in the active resume's extracted keywords. If no resume is active, resume_fit is null. If resume is active but fit = 0%, the job is skipped entirely.

### Salary Extraction

Extracts salary ranges from page text. Supported formats: `$140k–$180k`, `$140,000 - $180,000`, `USD 140,000`, `$140k/yr`. Sanity check: $20k–$1M range.

---

## 8. Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│ INGESTION (apps/listener)                                    │
│                                                              │
│  Firehose SSE ──► processEvent()                            │
│                     ├─ isJobBoardUrl() check                │
│                     ├─ extractCompany() from domain          │
│                     ├─ extractLocation() from text           │
│                     └─► insertJobPosting()                  │
│                                                              │
│  ATS/Mantiks/Scraper/SerpApi/HasData ──► insertJobPosting() │
│    (each source extracts title, company, location, desc)     │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ PROCESSING (processor.ts → insertJobPosting)                 │
│                                                              │
│  1. normalizeUrl() → strip UTM, trailing slash               │
│  2. sha256(url) → url_hash                                   │
│  3. Pre-filters: title → location → company → article        │
│  4. Dedup check: url_hash exists? → update last_seen, return │
│  5. scorePosting() → keyword groups + bonuses = total score  │
│  6. Seniority exclusion check                                │
│  7. computeResumeFit() → % overlap with active resume        │
│  8. Skip if resume active + 0% fit                           │
│  9. INSERT into job_postings                                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ STORAGE (Supabase Postgres)                                  │
│                                                              │
│  job_postings: url, url_hash, title, company, company_tier,  │
│    location, salary_min/max, score, resume_fit,              │
│    score_breakdown, keywords_matched, firehose_rule,         │
│    priority, page_content, first_seen, last_seen, status     │
│                                                              │
│  resume_versions: filename, is_active, keywords_extracted    │
│                                                              │
│  listener_state: key-value pairs for SSE offset persistence  │
│    (key: "last_event_id:{tap_name}", value: event ID)        │
│                                                              │
│  Storage bucket "resumes": uploaded PDF files                │
└────────────────────────────┬────────────────────────────────┘
                             │ Realtime (INSERT events via WebSocket)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (apps/web — Next.js)                                │
│                                                              │
│  /api/stats → SELECT count by priority, today's jobs         │
│  /api/jobs  → SELECT with filters, pagination, sorting       │
│  /api/poll  → POST to listener control server, GET status    │
│                                                              │
│  Dashboard: stat cards + top urgent jobs + realtime counter  │
│  Jobs list: filterable/sortable table + realtime counter     │
│  Job detail: score breakdown, resume fit, keywords, content  │
│  Resume: upload PDF, extract keywords, trigger re-score      │
│                                                              │
│  Supabase Realtime channels:                                 │
│    "job_postings_dashboard" → INSERT events (high priority)  │
│    "job_postings_list" → INSERT events (all)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Fallback Chain

Defined in `apps/listener/src/index.ts` (lines 220–234). Runs every 60 minutes.

```
Check: Is Mantiks dead? (lastPollAt > 8 hours ago)
Check: Is LinkedIn Scraper dead? (consecutiveFailures >= 3)

If BOTH dead:
  └─► Fallback 1: Run SerpApi immediately (if SERPAPI_API_KEY set)
  └─► Fallback 2: If no SerpApi key either → activate LinkedIn Direct scraper
```

**Normal priority chain:**
1. **Firehose** (always-on, real-time) — primary source
2. **ATS Direct** (hourly) — structured data from company ATSs
3. **Mantiks** (weekly) — LinkedIn via API
4. **LinkedIn Scraper** (2×/day) — LinkedIn via npm package
5. **SerpApi** (2×/day) — Google Jobs index, validates coverage
6. **HasData** (2×/day) — Indeed + Glassdoor supplementary
7. **LinkedIn Direct** (emergency) — last resort HTML scraping

---

## 10. Environment Variables

### Listener (`apps/listener`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Full write access to database |
| `FIREHOSE_MANAGEMENT_KEY` | Yes | Account 1 management API key (create/manage taps) |
| `FIREHOSE_MANAGEMENT_KEY_2` | No | Account 2 management key (Taps 4–5) |
| `FIREHOSE_MANAGEMENT_KEY_3` | No | Account 3 management key (Taps 6–7) |
| `FIREHOSE_TAP_TOKEN` | Auto | Tap 1 stream token (created/resolved on startup) |
| `FIREHOSE_TAP_TOKEN_2`..`_7` | Auto | Tap 2–7 stream tokens |
| `MANTIKS_API_KEY` | No | Mantiks.io API key for LinkedIn |
| `SERPAPI_API_KEY` | No | SerpApi key for Google Jobs |
| `HASDATA_API_KEY` | No | HasData key for Indeed + Glassdoor |
| `CONTROL_PORT` | No | HTTP control server port (default: 3001) |

### Frontend (`apps/web`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase URL (public, safe to expose) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (public, RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | For API routes only (server-side) |
| `LISTENER_URL` | No | Listener control server URL (default: `http://localhost:3001`) |

---

## 11. Control Server Endpoints

HTTP server running on the listener process (default port 3001).

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| GET | `/health` | Health check | `{ ok: true }` |
| GET | `/status` | ATS poll progress | `{ running, current, total }` |
| POST | `/poll` | Trigger ATS direct poll (all 236 companies) | `{ ok: true, message }` |
| POST | `/poll/linkedin` | Trigger LinkedIn npm scraper | `{ ok: true, message }` |
| POST | `/poll/mantiks` | Trigger Mantiks LinkedIn API poll | `{ ok: true, message }` |
| POST | `/poll/serpapi` | Trigger SerpApi Google Jobs poll | `{ ok: true, message }` |
| POST | `/poll/indeed` | Trigger HasData Indeed poll | `{ ok: true, message }` |
| POST | `/poll/glassdoor` | Trigger HasData Glassdoor poll | `{ ok: true, message }` |

All POST endpoints fire-and-forget (return immediately, poll runs in background). The frontend uses `GET /status` to track ATS poll progress (polled every 500ms during active poll).
