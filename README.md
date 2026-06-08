# FetchAnime — Content Intelligence Dashboard

Single-page app for monthly anime content research. Fetches live rankings from public APIs, scores content by fan-base size and genre, and generates a **14-niche monthly pack** with ready-made task cards.

Deploys as a static site — no build step, no server, works on GitHub Pages.

---

## What it does

1. **Pulls live data** from four sources simultaneously:
   - Anime series (AniList GraphQL)
   - Manga / Manhwa (AniList GraphQL)
   - Top characters by favorites (AniList GraphQL)
   - Anime-tagged games (RAWG REST API)

2. **Filters by age** — only content that started **more than 6 months ago** qualifies. New seasonal anime is excluded; the focus is on established series with active fan communities.

3. **Scores every item** using a Content Potential Score (CPS, 0–100):
   - Popularity rank + average rating
   - Genre weights (Ecchi, Harem, Romance, Isekai score higher — larger NSFW fan-art communities)
   - Favorites count

4. **Generates a monthly pack of 14 niches**:

   | Slot | Category | Count |
   |------|----------|-------|
   | 1–5  | Anime series | 5 |
   | 6–8  | Characters (waifu/top favorites) | 3 |
   | 9–11 | Anime games | 3 |
   | 12–13 | Manga / Manhwa | 2 |
   | 14   | Wildcard (highest remaining CPS) | 1 |

   Each task card includes: thumbnail, why it was selected, 3 content ideas, priority level (HIGH / MEDIUM).

5. **Export options**:
   - **Copy Tasks** — full pack as plain text
   - **Export JSON** — structured pack
   - **Save Names** — flat `.txt` list of character names (one per line) for generation prompts. Anime/manga contribute their top-5 main characters (pulled in the same AniList query); Characters slots contribute their own name; games resolve via a curated character map with an AniList anime-adaptation fallback. Names are deduplicated.

---

## Live demo

Deployed at: `https://richisquarez.github.io/fetchanime/`

To enable GitHub Pages: repo Settings → Pages → Source: **Deploy from branch** → `main` / `(root)`.

---

## Local development

The app makes cross-origin API requests, so it must be served over HTTP — opening `index.html` directly via `file://` will fail with a CORS/network error.

```bash
# Python (no install needed)
cd fetchanime
python3 -m http.server 8080
# open http://localhost:8080

# Node (if npx available)
npx serve .
```

---

## API keys

### AniList token (optional)

AniList's public GraphQL endpoint works without authentication. An OAuth access token is only useful if you hit the anonymous rate limit (90 req/min) during heavy use.

**How to get one:**
1. Go to [anilist.co/settings/developer](https://anilist.co/settings/developer)
2. Create a new client (redirect URI can be anything, e.g. `https://localhost`)
3. Open: `https://anilist.co/api/v2/oauth/authorize?client_id=YOUR_ID&response_type=token`
4. Authorize → copy the access token from the redirect URL fragment

Paste it into the **AniList token** field in the header. The token is saved in `localStorage` and sent as `Authorization: Bearer <token>` on every GraphQL request.

**Rate limit handling:** if the API returns `429 Too Many Requests`, the app automatically waits for the `Retry-After` duration and retries up to 3 times before surfacing an error.

### RAWG API key (optional)

RAWG works without a key at reduced rate limits. For reliable results:
1. Register at [rawg.io/apidocs](https://rawg.io/apidocs) — free, no credit card
2. Copy your key and paste it into the **RAWG API key** field

Both keys are persisted in `localStorage` under `fa_anilist_token` and `fa_rawg_key`.

---

## Scoring formula

```
CPS (anime/manga) = pop_score×0.55 + rating_score×0.25 + genre_score×0.20

CPS (character)   = favorites_score×0.75 + source_popularity×0.15 + source_genres×0.10

CPS (game)        = added_score×0.60 + metacritic×0.28 + review_count×0.12
```

Genre weights (partial):

| Genre | Weight |
|-------|--------|
| Ecchi | 35 |
| Harem | 30 |
| Romance | 25 |
| Isekai | 22 |
| Seinen | 20 |
| Fantasy | 18 |
| School | 15 |

---

## Project structure

```
fetchanime/
├── index.html   — SPA markup, header controls, tab/grid layout
├── style.css    — Dark anime aesthetic, responsive
├── app.js       — API clients, scoring, pack generation, rendering
└── README.md    — This file
```

---

## Stack

- Vanilla JS (ES2022, no build toolchain)
- [AniList GraphQL API](https://graphql.anilist.co) — anime, manga, characters
- [RAWG REST API](https://rawg.io/apidocs) — anime-tagged games
- GitHub Pages for hosting
