/* ============================================================
   FetchAnime — Content Intelligence Dashboard
   Sources:
     - AniList GraphQL  https://graphql.anilist.co  (no key needed)
     - RAWG REST API    https://rawg.io/apidocs      (optional free key)
   ============================================================ */

'use strict';

// ── CONSTANTS ─────────────────────────────────────────────────

// Public GraphQL endpoint — never put API keys in the URL path
const ANILIST_URL = 'https://graphql.anilist.co';
const RAWG_URL    = 'https://api.rawg.io/api';


// Age cutoff: content must have started > 6 months ago
const CUTOFF_DATE = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d;
})();

// AniList integer date format  e.g. 20251126
const CUTOFF_ANILIST = parseInt(
  `${CUTOFF_DATE.getFullYear()}` +
  `${String(CUTOFF_DATE.getMonth() + 1).padStart(2, '0')}` +
  `${String(CUTOFF_DATE.getDate()).padStart(2, '0')}`
);

// RAWG date string  e.g. "2025-11-26"
const CUTOFF_RAWG = CUTOFF_DATE.toISOString().slice(0, 10);

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const NOW = new Date();

// ── GENRE WEIGHTS (content potential signal) ──────────────────
// Higher = bigger NSFW/fan-art community around that genre
const GENRE_W = {
  Ecchi: 35, Harem: 30, Romance: 25, Isekai: 22, Seinen: 20,
  Fantasy: 18, School: 15, Magic: 14, Supernatural: 12,
  Action: 11, Adventure: 10, 'Slice of Life': 10,
  Comedy: 8, Drama: 8, Psychological: 8, 'Martial Arts': 7,
  Mecha: 6, Sports: 5,
};

// ── CONTENT IDEA TEMPLATES ────────────────────────────────────
const IDEAS = {
  anime: [
    t => `Solo waifu art series — iconic female characters from "${t}"`,
    t => `Key scene recreation with artistic liberties`,
    t => `Most popular ship/pair — original art continuation`,
    t => `Alternative-universe outfit variations (beach, fantasy, casual)`,
    t => `Character lore-accurate editorial — single character focus`,
  ],
  game: [
    t => `Top waifus from "${t}" — signature art series`,
    t => `Character design recreation with artistic liberties`,
    t => `Event/gacha character art expansion`,
    t => `"${t}" × popular anime crossover concept`,
  ],
  character: [
    n => `"${n}" — outfit variation series (casual · beach · fantasy)`,
    n => `"${n}" solo editorial, multiple visual styles`,
    n => `"${n}" × trending character crossover art`,
  ],
  manga: [
    t => `Scene recreation from standout "${t}" chapters`,
    t => `Character design variations and original expansions`,
    t => `Cover-art homage series`,
  ],
};

// ── APP STATE ─────────────────────────────────────────────────
const S = {
  anime:      [],
  manga:      [],
  characters: [],
  games:      [],
  pack:       [],
};

// ── ANILIST HELPER ────────────────────────────────────────────
function anilistHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    Accept:         'application/json',
  };
  // Optional OAuth access token (higher rate limits). Not required for public queries.
  const token = document.getElementById('anilistToken')?.value.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function gql(query, variables = {}, attempt = 0) {
  let r;
  try {
    r = await fetch(ANILIST_URL, {
      method:  'POST',
      headers: anilistHeaders(),
      body:    JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new Error(
      `Network error (${e.message}). Open via a local server (e.g. python3 -m http.server 8080), not file://`
    );
  }

  if (r.status === 429 && attempt < 3) {
    const wait = (parseInt(r.headers.get('Retry-After'), 10) || 30) * 1000;
    await sleep(wait);
    return gql(query, variables, attempt + 1);
  }

  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`AniList ${r.status}: invalid response (check the API URL)`);
  }

  if (!r.ok) {
    const msg = json.errors?.[0]?.message ?? json.message ?? text.slice(0, 120);
    throw new Error(`AniList ${r.status}: ${msg}`);
  }
  if (json.errors?.length) throw new Error(json.errors[0].message);
  if (!json.data) throw new Error('AniList returned no data');
  return json.data;
}

// ── DATA FETCHERS ─────────────────────────────────────────────

async function fetchAnime() {
  // TRENDING_DESC = ranked by current-week activity on AniList (watches, list adds, score updates).
  // Combined with startDate_lesser this gives "established titles that are hot right now" —
  // much more useful than POPULARITY_DESC (all-time accumulation, never changes).
  const q = `
    query($cutoff: FuzzyDateInt) {
      Page(page: 1, perPage: 50) {
        media(
          type: ANIME
          sort: TRENDING_DESC
          averageScore_greater: 65
          startDate_lesser: $cutoff
          status_in: [FINISHED, RELEASING]
        ) {
          id
          title { english romaji }
          popularity
          favourites
          averageScore
          trending
          genres
          coverImage { large }
          startDate { year month }
          siteUrl
          characters(role: MAIN, sort: [FAVOURITES_DESC], perPage: 5) {
            nodes { name { full } }
          }
        }
      }
    }`;
  const d = await gql(q, { cutoff: CUTOFF_ANILIST });
  const media = d.Page?.media ?? [];
  if (!media.length) throw new Error('No anime returned — try again in a minute (rate limit)');
  return media.filter(m => m.popularity > 4000);
}

async function fetchManga() {
  const q = `
    query($cutoff: FuzzyDateInt) {
      Page(page: 1, perPage: 40) {
        media(
          type: MANGA
          sort: TRENDING_DESC
          averageScore_greater: 65
          startDate_lesser: $cutoff
        ) {
          id
          title { english romaji }
          popularity
          favourites
          averageScore
          trending
          genres
          coverImage { large }
          countryOfOrigin
          startDate { year }
          siteUrl
          characters(role: MAIN, sort: [FAVOURITES_DESC], perPage: 5) {
            nodes { name { full } }
          }
        }
      }
    }`;
  const d = await gql(q, { cutoff: CUTOFF_ANILIST });
  const media = d.Page?.media ?? [];
  if (!media.length) throw new Error('No manga returned — try again in a minute (rate limit)');
  return media.filter(m => m.popularity > 2000);
}

async function fetchCharacters() {
  // Fetch a large pool so the 70/30 gender split has enough candidates in each bucket.
  // Two sequential pages to stay under rate limits.
  const q = `
    query($page: Int) {
      Page(page: $page, perPage: 50) {
        characters(sort: FAVOURITES_DESC) {
          id
          name { full }
          favourites
          image { large }
          gender
          media(perPage: 1, sort: POPULARITY_DESC, type: ANIME) {
            nodes {
              title { english romaji }
              genres
              popularity
            }
          }
        }
      }
    }`;

  const [d1, d2] = await Promise.all([
    gql(q, { page: 1 }),
    gql(q, { page: 2 }),
  ]);

  const raw = [
    ...(d1.Page?.characters ?? []),
    ...(d2.Page?.characters ?? []),
  ];

  if (!raw.length) throw new Error('No characters returned — try again in a minute (rate limit)');

  return raw.filter(c => c.favourites > 8000 && c.media?.nodes?.length > 0);
}

// Split a scored character list into a 70% female / 30% male display set.
// AniList gender values: "Female" | "Male" | "Non-binary" | null
// null/unknown → treated as female bucket (most are unlabelled female chars).
function genderSplit(chars, total) {
  const scored = [...chars]
    .map(c => ({ ...c, _score: scoreCharacter(c) }))
    .sort((a, b) => b._score - a._score);

  const female = scored.filter(c => (c.gender ?? 'Female').toLowerCase() !== 'male');
  const male   = scored.filter(c => c.gender?.toLowerCase() === 'male');

  const nFemale = Math.round(total * 0.7);  // 70 %
  const nMale   = total - nFemale;          // 30 %

  // Combine and re-sort so the grid is ranked by CPS, not gender
  return [
    ...female.slice(0, nFemale),
    ...male.slice(0, Math.min(nMale, male.length)),
  ].sort((a, b) => b._score - a._score);
}

async function fetchGames(apiKey) {
  // Two pages for variety; RAWG works without key (lower rate limits)
  const base = {
    tags:       'anime',
    ordering:   '-added',
    page_size:  '30',
    dates:      `2014-01-01,${CUTOFF_RAWG}`,
    ...(apiKey ? { key: apiKey } : {}),
  };

  async function page(n) {
    const p = new URLSearchParams({ ...base, page: String(n) });
    const r = await fetch(`${RAWG_URL}/games?${p}`);
    if (!r.ok) throw new Error(`RAWG ${r.status}`);
    return (await r.json()).results ?? [];
  }

  const [p1, p2] = await Promise.allSettled([page(1), page(2)]);
  const results = [
    ...(p1.status === 'fulfilled' ? p1.value : []),
    ...(p2.status === 'fulfilled' ? p2.value : []),
  ];

  if (!results.length) throw new Error('No results — try adding a RAWG API key');
  return results;
}

// ── GAME CHARACTER RESOLUTION ─────────────────────────────────
// RAWG has no character data, and no free CORS-friendly game-character API
// exists. So games resolve names in two steps:
//   1. Curated map below (the universes that matter for this niche).
//   2. Fallback: AniList anime-adaptation main characters (only if >= 3 found).
// Maintenance: when a game drops a notable new unit, add it here (~5 min/quarter).
const GAME_CHARS = {
  'Genshin Impact':        ['Raiden Shogun', 'Hu Tao', 'Ganyu', 'Yae Miko', 'Nahida', 'Furina', 'Yelan', 'Eula'],
  'Honkai Star Rail':      ['Kafka', 'Silver Wolf', 'Firefly', 'Jingliu', 'Black Swan', 'Acheron', 'Robin', 'Castorice'],
  'Zenless Zone Zero':     ['Ellen Joe', 'Miyabi', 'Jane Doe', 'Burnice', 'Zhu Yuan', 'Nicole Demara', 'Yixuan'],
  'Honkai Impact 3rd':     ['Kiana Kaslana', 'Raiden Mei', 'Bronya Zaychik', 'Elysia', 'Seele Vollerei'],
  'Wuthering Waves':       ['Jinhsi', 'Changli', 'Yinlin', 'Camellya', 'Carlotta', 'Shorekeeper'],
  'Nikke':                 ['Rapi', 'Anis', 'Neon', 'Scarlet', 'Modernia', 'Red Hood'],
  'Blue Archive':          ['Hoshino', 'Shiroko', 'Hina', 'Mika', 'Arisu', 'Yuuka'],
  'Azur Lane':             ['Enterprise', 'Belfast', 'Atago', 'Taihou', 'Bremerton', 'Formidable'],
  'Arknights':             ['Amiya', 'Texas', 'Exusiai', 'Skadi', 'Surtr', 'Nian'],
  'Fate Grand Order':      ['Mash Kyrielight', 'Artoria Pendragon', 'Jeanne d\'Arc', 'Scathach', 'Tamamo no Mae', 'Ishtar'],
  'Granblue Fantasy':      ['Djeeta', 'Narmaya', 'Zooey', 'Ferry', 'Cagliostro'],
  'Princess Connect':      ['Pecorine', 'Kyaru', 'Kokkoro', 'Karyl'],
  'Punishing Gray Raven':  ['Lucia', 'Liv', 'Bianca', 'Karenina'],
  'Goddess of Victory Nikke': ['Rapi', 'Anis', 'Neon', 'Scarlet', 'Modernia', 'Red Hood'],
  'NieR Automata':         ['2B', 'A2', '9S'],
  'Stellar Blade':         ['Eve', 'Adam', 'Lily'],
  'Persona 5':             ['Makoto Niijima', 'Ann Takamaki', 'Futaba Sakura', 'Kasumi Yoshizawa'],
  'Persona 3':             ['Aigis', 'Mitsuru Kirijo', 'Yukari Takeba'],
  'Final Fantasy VII':     ['Tifa Lockhart', 'Aerith Gainsborough', 'Yuffie Kisaragi'],
  'Final Fantasy X':       ['Yuna', 'Rikku', 'Lulu'],
  'Tales of Arise':        ['Shionne', 'Rinwell', 'Kisara'],
  'Street Fighter':        ['Chun-Li', 'Cammy', 'Juri'],
  'Guilty Gear':           ['Bridget', 'Jack-O', 'Baiken', 'Dizzy'],
  'Overwatch':             ['D.Va', 'Widowmaker', 'Mercy', 'Kiriko'],
  'League of Legends':     ['Ahri', 'Jinx', 'Lux', 'Evelynn'],
};

function normalizeGameKey(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Pre-normalized lookup index, built once.
const GAME_CHARS_IDX = Object.fromEntries(
  Object.entries(GAME_CHARS).map(([k, v]) => [normalizeGameKey(k), v])
);

// Match a RAWG game title (which may carry subtitles/editions like
// "Persona 5 Royal" or "Final Fantasy VII Remake") against the curated map.
// Strategy: exact normalized hit, else the longest canonical key contained
// in the game name (longest wins so "final fantasy vii" beats "final fantasy").
function lookupGameMap(name) {
  const n = normalizeGameKey(name);
  if (GAME_CHARS_IDX[n]) return GAME_CHARS_IDX[n];
  let best = null, bestLen = 0;
  for (const key of Object.keys(GAME_CHARS_IDX)) {
    if (n.includes(key) && key.length > bestLen) {
      best = GAME_CHARS_IDX[key];
      bestLen = key.length;
    }
  }
  return best;
}

const GAME_FALLBACK_QUERY = `
  query($s: String) {
    Page(page: 1, perPage: 1) {
      media(search: $s, type: ANIME, sort: SEARCH_MATCH) {
        characters(role: MAIN, sort: [FAVOURITES_DESC], perPage: 5) {
          nodes { name { full } }
        }
      }
    }
  }`;

// Search variants for the AniList fallback: full RAWG title plus a "base" title
// with the subtitle/edition stripped. RAWG names like "Sword Art Online: Last
// Recollection" don't match the anime, but "Sword Art Online" does.
function gameSearchVariants(name) {
  const full = String(name).trim();
  const base = full.split(/\s*[:\-–—]\s*/)[0].trim();   // text before first colon/dash
  return base && base.toLowerCase() !== full.toLowerCase() ? [full, base] : [full];
}

// Resolve a game's character names: curated map first, AniList adaptation second.
// Returns [] if neither yields a usable roster (caller simply skips the game).
async function resolveGameCharacters(name) {
  const mapped = lookupGameMap(name);
  if (mapped) return mapped.slice(0, 6);

  for (const variant of gameSearchVariants(name)) {
    try {
      const d = await gql(GAME_FALLBACK_QUERY, { s: variant });
      const nodes = d.Page?.media?.[0]?.characters?.nodes ?? [];
      // Promo shorts (Genshin/HSR/ZZZ adaptations) return 1-2 chars — skip those.
      if (nodes.length >= 3) return nodes.slice(0, 5).map(c => c.name.full).filter(Boolean);
    } catch (_) {
      // Network/rate-limit on a single game shouldn't fail the whole export.
    }
  }
  return [];
}

// ── SCORING ───────────────────────────────────────────────────

function genreScore(genres = []) {
  return genres.reduce((s, g) => s + (GENRE_W[g] ?? 0), 0);
}

function scoreAnime(item, maxPop) {
  const pop    = Math.min(45, (item.popularity / maxPop) * 45);
  const rating = ((item.averageScore ?? 70) / 100) * 25;
  const genre  = Math.min(20, genreScore(item.genres) * 0.45);
  // trending rank: 1 = hottest right now, higher = less hot.
  // Contributes up to 10 pts; drops to 0 around rank 100+.
  const trend  = item.trending ? Math.max(0, 10 - Math.floor(item.trending / 10)) : 0;
  return Math.round(pop + rating + genre + trend);
}

function scoreManga(item, maxPop) {
  const pop    = Math.min(45, (item.popularity / maxPop) * 45);
  const rating = ((item.averageScore ?? 70) / 100) * 25;
  const genre  = Math.min(20, genreScore(item.genres) * 0.45);
  const trend  = item.trending ? Math.max(0, 10 - Math.floor(item.trending / 10)) : 0;
  return Math.round(pop + rating + genre + trend);
}

function scoreCharacter(item) {
  const fav   = Math.min(75, (item.favourites / 250000) * 75);
  const media = item.media?.nodes?.[0];
  const mPop  = media ? Math.min(15, (media.popularity / 400000) * 15) : 0;
  const mGen  = Math.min(10, genreScore(media?.genres ?? []) * 0.25);
  return Math.round(fav + mPop + mGen);
}

function scoreGame(item) {
  const added  = Math.min(60, ((item.added ?? 0) / 150000) * 60);
  const mc     = ((item.metacritic ?? 70) / 100) * 28;
  const revs   = Math.min(12, ((item.reviews_count ?? 0) / 800) * 12);
  return Math.round(added + mc + revs);
}

// ── PACK GENERATION ───────────────────────────────────────────

function pick(ideas, name, i) {
  return ideas[i % ideas.length](name);
}

// Top main-character names attached to an anime/manga item by the GraphQL query.
function charNames(item) {
  return (item.characters?.nodes ?? []).map(c => c.name?.full).filter(Boolean);
}

function generatePack() {
  const maxAnP = Math.max(...S.anime.map(a => a.popularity), 1);
  const maxMnP = Math.max(...S.manga.map(m => m.popularity), 1);

  const anime = [...S.anime]
    .map(a => ({ ...a, _score: scoreAnime(a, maxAnP), _t: 'anime' }))
    .sort((a, b) => b._score - a._score);

  const manga = [...S.manga]
    .map(m => ({ ...m, _score: scoreManga(m, maxMnP), _t: 'manga' }))
    .sort((a, b) => b._score - a._score);

  // Characters: 2 female (70 %) + 1 male (30 %) for the 3-slot pack
  const charsSplit = genderSplit(S.characters, 3)
    .map(c => ({ ...c, _t: 'character' }));
  const chars = charsSplit;

  const games = [...S.games]
    .map(g => ({ ...g, _score: scoreGame(g), _t: 'game' }))
    .sort((a, b) => b._score - a._score);

  const pack = [];

  // ── 5 Anime series
  anime.slice(0, 5).forEach((item, i) => {
    const title = item.title.english || item.title.romaji;
    pack.push({
      type:     'anime',
      title,
      image:    item.coverImage?.large,
      score:    item._score,
      reason:   `${item.popularity.toLocaleString()} fans · ★ ${item.averageScore ?? '?'} · ${(item.genres ?? []).slice(0, 2).join(', ')}`,
      ideas:    [pick(IDEAS.anime, title, 0), pick(IDEAS.anime, title, 1), pick(IDEAS.anime, title, 2)],
      priority: i < 2 ? 'HIGH' : 'MEDIUM',
      url:      item.siteUrl,
      names:    charNames(item),
    });
  });

  // ── 3 Characters
  chars.slice(0, 3).forEach((item, i) => {
    const name   = item.name.full;
    const source = item.media?.nodes?.[0]?.title?.english
                || item.media?.nodes?.[0]?.title?.romaji
                || '?';
    pack.push({
      type:     'character',
      title:    name,
      subtitle: `from ${source}`,
      image:    item.image?.large,
      score:    item._score,
      reason:   `${item.favourites.toLocaleString()} favorites on AniList`,
      ideas:    [pick(IDEAS.character, name, 0), pick(IDEAS.character, name, 1), pick(IDEAS.character, name, 2)],
      priority: i === 0 ? 'HIGH' : 'MEDIUM',
      names:    [name],
    });
  });

  // ── 3 Games
  games.slice(0, 3).forEach((item, i) => {
    const title = item.name;
    pack.push({
      type:     'game',
      title,
      image:    item.background_image,
      score:    item._score,
      reason:   `${(item.added ?? 0).toLocaleString()} RAWG players · Metacritic ${item.metacritic ?? 'N/A'}`,
      ideas:    [pick(IDEAS.game, title, 0), pick(IDEAS.game, title, 1), pick(IDEAS.game, title, 2)],
      priority: i === 0 ? 'HIGH' : 'MEDIUM',
    });
  });

  // ── 2 Manga / Manhwa
  manga.slice(0, 2).forEach(item => {
    const title   = item.title.english || item.title.romaji;
    const country = item.countryOfOrigin === 'KR' ? 'Manhwa' : item.countryOfOrigin === 'CN' ? 'Manhua' : 'Manga';
    pack.push({
      type:     'manga',
      title,
      subtitle: country,
      image:    item.coverImage?.large,
      score:    item._score,
      reason:   `${item.popularity.toLocaleString()} readers · ★ ${item.averageScore ?? '?'} · ${country}`,
      ideas:    [pick(IDEAS.manga, title, 0), pick(IDEAS.manga, title, 1), pick(IDEAS.manga, title, 2)],
      priority: 'MEDIUM',
      url:      item.siteUrl,
      names:    charNames(item),
    });
  });

  // ── 1 Wildcard (highest score from remaining pool)
  const rest = [
    ...anime.slice(5, 15),
    ...chars.slice(3, 10),
    ...games.slice(3, 8),
  ].sort((a, b) => b._score - a._score);

  if (rest[0]) {
    const w = rest[0];
    let entry;
    if (w._t === 'anime') {
      const title = w.title.english || w.title.romaji;
      entry = {
        type: 'anime', title, image: w.coverImage?.large, score: w._score,
        reason: `Wildcard · ${w.popularity.toLocaleString()} fans · high content score`,
        ideas: [pick(IDEAS.anime, title, 3), pick(IDEAS.anime, title, 4), pick(IDEAS.anime, title, 0)],
        names: charNames(w),
      };
    } else if (w._t === 'character') {
      const name = w.name.full;
      const src  = w.media?.nodes?.[0]?.title?.english || w.media?.nodes?.[0]?.title?.romaji || '?';
      entry = {
        type: 'character', title: name, subtitle: `from ${src}`, image: w.image?.large, score: w._score,
        reason: `Wildcard · ${w.favourites.toLocaleString()} favorites`,
        ideas: [pick(IDEAS.character, name, 0), pick(IDEAS.character, name, 1), pick(IDEAS.character, name, 2)],
        names: [name],
      };
    } else {
      const title = w.name;
      entry = {
        type: 'game', title, image: w.background_image, score: w._score,
        reason: `Wildcard game · ${(w.added ?? 0).toLocaleString()} players`,
        ideas: [pick(IDEAS.game, title, 0), pick(IDEAS.game, title, 1), pick(IDEAS.game, title, 3)],
      };
    }
    pack.push({ ...entry, priority: 'MEDIUM', wildcard: true });
  }

  S.pack = pack;
  return pack;
}

// ── RENDER HELPERS ────────────────────────────────────────────

const ICON = { anime: '⛩', game: '🎮', character: '✦', manga: '📖' };

function img(src, alt, cls) {
  return src
    ? `<img class="${cls}" src="${src}" alt="${esc(alt)}" loading="lazy">`
    : `<div class="${cls.replace('-img', '-placeholder')}">${ICON[alt] ?? '✦'}</div>`;
}

function esc(s = '') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function popBar(val, max) {
  const pct = Math.min(100, Math.round((val / max) * 100));
  return `<div class="pop-bar"><div class="pop-bar-fill" style="width:${pct}%"></div></div>`;
}

// ── CARD RENDERS ──────────────────────────────────────────────

function cardAnime(item, idx, maxPop) {
  const title  = item.title.english || item.title.romaji;
  const score  = scoreAnime(item, maxPop);
  const genres = (item.genres ?? []).slice(0, 2);
  const trendTag = item.trending
    ? `<span class="tag tag-trend">↑ Trend #${item.trending}</span>`
    : '';
  return `
  <div class="content-card">
    <div class="card-rank">#${idx + 1}</div>
    <div class="card-cps">${score}</div>
    ${img(item.coverImage?.large, 'anime', 'card-img')}
    <div class="card-body">
      <div class="card-title">${esc(title)}</div>
      <div class="card-tags">
        ${item.startDate?.year ? `<span class="tag tag-year">${item.startDate.year}</span>` : ''}
        ${genres.map(g => `<span class="tag tag-genre">${esc(g)}</span>`).join('')}
        <span class="tag tag-score">★ ${item.averageScore ?? '?'}</span>
        ${trendTag}
      </div>
      <div class="card-pop">${item.popularity.toLocaleString()} fans</div>
      ${popBar(item.popularity, maxPop)}
    </div>
  </div>`;
}

function cardManga(item, idx, maxPop) {
  const title    = item.title.english || item.title.romaji;
  const score    = scoreManga(item, maxPop);
  const country  = item.countryOfOrigin === 'KR' ? 'KR' : item.countryOfOrigin === 'CN' ? 'CN' : 'JP';
  const genres   = (item.genres ?? []).slice(0, 2);
  const trendTag = item.trending
    ? `<span class="tag tag-trend">↑ Trend #${item.trending}</span>`
    : '';
  return `
  <div class="content-card">
    <div class="card-rank">#${idx + 1}</div>
    <div class="card-cps">${score}</div>
    ${img(item.coverImage?.large, 'manga', 'card-img')}
    <div class="card-body">
      <div class="card-title">${esc(title)}</div>
      <div class="card-tags">
        <span class="tag tag-year">${country} · ${item.startDate?.year ?? '?'}</span>
        ${genres.map(g => `<span class="tag tag-genre">${esc(g)}</span>`).join('')}
        <span class="tag tag-score">★ ${item.averageScore ?? '?'}</span>
        ${trendTag}
      </div>
      <div class="card-pop">${item.popularity.toLocaleString()} readers</div>
      ${popBar(item.popularity, maxPop)}
    </div>
  </div>`;
}

function cardChar(item, idx) {
  const score     = scoreCharacter(item);
  const fromTitle = item.media?.nodes?.[0]?.title?.english
                  || item.media?.nodes?.[0]?.title?.romaji || '';
  const MAX_FAV   = 280000;
  const genderLow = (item.gender ?? '').toLowerCase();
  const genderTag = item.gender
    ? `<span class="tag ${genderLow === 'male' ? 'tag-male' : 'tag-female'}">${esc(item.gender)}</span>`
    : `<span class="tag tag-female">Female</span>`;
  return `
  <div class="content-card">
    <div class="card-rank">#${idx + 1}</div>
    <div class="card-cps">${score}</div>
    ${img(item.image?.large, 'character', 'card-img')}
    <div class="card-body">
      <div class="card-title">${esc(item.name.full)}</div>
      <div class="card-tags">
        ${genderTag}
        ${fromTitle ? `<span class="tag tag-genre">${esc(fromTitle.length > 20 ? fromTitle.slice(0,19)+'…' : fromTitle)}</span>` : ''}
      </div>
      <div class="card-pop">♥ ${item.favourites.toLocaleString()} favorites</div>
      ${popBar(item.favourites, MAX_FAV)}
    </div>
  </div>`;
}

function cardGame(item, idx) {
  const score   = scoreGame(item);
  const MAX_ADD = 200000;
  return `
  <div class="content-card">
    <div class="card-rank">#${idx + 1}</div>
    <div class="card-cps">${score}</div>
    ${img(item.background_image, 'game', 'card-img')}
    <div class="card-body">
      <div class="card-title">${esc(item.name)}</div>
      <div class="card-tags">
        ${item.released ? `<span class="tag tag-year">${item.released.slice(0,4)}</span>` : ''}
        ${item.metacritic ? `<span class="tag tag-meta">MC ${item.metacritic}</span>` : ''}
      </div>
      <div class="card-pop">${(item.added ?? 0).toLocaleString()} players tracked</div>
      ${popBar(item.added ?? 0, MAX_ADD)}
    </div>
  </div>`;
}

function cardTask(item, n) {
  const tc = `tt-${item.type}`;
  const pc = `tp-${item.priority.toLowerCase()}`;
  const icon = ICON[item.type] ?? '✦';
  const wTag = item.wildcard ? ' ★' : '';
  return `
  <div class="task-card">
    <div class="task-head">
      <div class="task-num">${n}</div>
      <span class="task-type ${tc}">${esc(item.type)}${wTag}</span>
      <span class="task-prio ${pc}">${esc(item.priority)}</span>
    </div>
    <div class="task-body">
      <div class="task-row">
        ${item.image
          ? `<img class="task-thumb" src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy">`
          : `<div class="task-thumb-placeholder">${icon}</div>`}
        <div class="task-info">
          <div class="task-name">${esc(item.title)}</div>
          ${item.subtitle ? `<div class="task-sub">${esc(item.subtitle)}</div>` : ''}
          <div class="task-why">${esc(item.reason)}</div>
        </div>
      </div>
      <div class="ideas-label">Content Ideas</div>
      <ul class="ideas-list">
        ${item.ideas.map(id => `<li>${esc(id)}</li>`).join('')}
      </ul>
      <div class="task-foot">
        <span>CPS ${item.score}/100</span>
        <div class="task-bar-wrap">
          <div class="task-bar" style="width:${item.score}%"></div>
        </div>
      </div>
    </div>
  </div>`;
}

// ── GRID HELPERS ──────────────────────────────────────────────

function gridLoading(id, msg) {
  document.getElementById(id).innerHTML =
    `<div class="state-msg"><span class="spinner"></span>${msg}</div>`;
}

function gridError(id, msg) {
  document.getElementById(id).innerHTML =
    `<div class="state-msg state-error">Error: ${esc(msg)}</div>`;
}

// ── DATA LOADERS ──────────────────────────────────────────────

async function loadAnime() {
  gridLoading('animeGrid', 'Fetching anime rankings from AniList…');
  try {
    S.anime = await fetchAnime();
    const max = Math.max(...S.anime.map(a => a.popularity), 1);
    document.getElementById('animeGrid').innerHTML =
      S.anime.slice(0, 24).map((a, i) => cardAnime(a, i, max)).join('');
    document.getElementById('statAnime').textContent = S.anime.length;
  } catch (e) {
    gridError('animeGrid', e.message);
    document.getElementById('statAnime').textContent = 'Err';
  }
}

async function loadManga() {
  gridLoading('mangaGrid', 'Fetching manga / manhwa from AniList…');
  try {
    S.manga = await fetchManga();
    const max = Math.max(...S.manga.map(m => m.popularity), 1);
    document.getElementById('mangaGrid').innerHTML =
      S.manga.slice(0, 20).map((m, i) => cardManga(m, i, max)).join('');
    document.getElementById('statManga').textContent = S.manga.length;
  } catch (e) {
    gridError('mangaGrid', e.message);
    document.getElementById('statManga').textContent = 'Err';
  }
}

async function loadCharacters() {
  gridLoading('charsGrid', 'Fetching top characters from AniList…');
  try {
    S.characters = await fetchCharacters();
    // Apply 70 % female / 30 % male split for the display grid of 24 cards
    const display = genderSplit(S.characters, 24);
    document.getElementById('charsGrid').innerHTML =
      display.map((c, i) => cardChar(c, i)).join('');
    const femaleCount = S.characters.filter(c => (c.gender ?? 'Female').toLowerCase() !== 'male').length;
    const maleCount   = S.characters.filter(c => c.gender?.toLowerCase() === 'male').length;
    document.getElementById('statChars').textContent = S.characters.length;
    document.getElementById('charGenderNote').textContent =
      `Pool: ${femaleCount}F / ${maleCount}M — showing 70/30`;
  } catch (e) {
    gridError('charsGrid', e.message);
    document.getElementById('statChars').textContent = 'Err';
    document.getElementById('charGenderNote').textContent = '';
  }
}

async function loadGames() {
  gridLoading('gamesGrid', 'Fetching anime games from RAWG…');
  const key = document.getElementById('rawgKey').value.trim();
  try {
    S.games = await fetchGames(key);
    document.getElementById('gamesGrid').innerHTML =
      S.games.slice(0, 24).map((g, i) => cardGame(g, i)).join('');
    document.getElementById('statGames').textContent = S.games.length;
  } catch (e) {
    gridError('gamesGrid', e.message + ' — get a free key at rawg.io/apidocs');
    document.getElementById('statGames').textContent = 'Err';
  }
}

// ── EXPORT HELPERS ────────────────────────────────────────────

function packToText() {
  const header = `=== MONTHLY CONTENT PACK — ${MONTHS[NOW.getMonth()].toUpperCase()} ${NOW.getFullYear()} ===\n` +
                 `14 Niches for Romchik\nGenerated: ${NOW.toDateString()}\n` +
                 `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  const body = S.pack.map((item, i) => [
    `TASK #${i + 1} [${item.type.toUpperCase()}] ${item.priority}${item.wildcard ? ' ★ WILDCARD' : ''}`,
    `Title    : ${item.title}${item.subtitle ? ' (' + item.subtitle + ')' : ''}`,
    `Why      : ${item.reason}`,
    `CPS Score: ${item.score}/100`,
    `Ideas:`,
    ...item.ideas.map(id => `  → ${id}`),
  ].join('\n')).join('\n\n');
  return header + body;
}

function packToJSON() {
  return JSON.stringify({
    month:    `${MONTHS[NOW.getMonth()]} ${NOW.getFullYear()}`,
    generated: NOW.toISOString(),
    niches:   S.pack,
  }, null, 2);
}

// Flat character-name list for generation — one name per line, deduped.
// Anime/manga contribute their top main characters; the Characters slots
// contribute their own name; games resolve via map/AniList fallback.
async function packToNames() {
  const collected = [];
  for (const item of S.pack) {
    if (item.type === 'game') {
      collected.push(...await resolveGameCharacters(item.title));
    } else if (Array.isArray(item.names)) {
      collected.push(...item.names);
    }
  }

  const seen = new Set();
  const out  = [];
  for (const raw of collected) {
    const name = String(raw).trim();
    const key  = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.join('\n');
}

// ── TOAST ─────────────────────────────────────────────────────

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ── INIT ──────────────────────────────────────────────────────

function initUI() {
  const label = `${MONTHS[NOW.getMonth()]} ${NOW.getFullYear()}`;
  document.getElementById('monthBadge').textContent = label;
  document.getElementById('packMonth').textContent  = label;

  // Restore saved API keys
  const savedRawg = localStorage.getItem('fa_rawg_key') ?? '';
  if (savedRawg) document.getElementById('rawgKey').value = savedRawg;

  const savedAni = localStorage.getItem('fa_anilist_token') ?? '';
  if (savedAni) document.getElementById('anilistToken').value = savedAni;

  document.getElementById('rawgKey').addEventListener('change', e => {
    localStorage.setItem('fa_rawg_key', e.target.value.trim());
  });

  document.getElementById('anilistToken').addEventListener('change', e => {
    localStorage.setItem('fa_anilist_token', e.target.value.trim());
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      // pane IDs: paneAnime, paneGames, paneCharacters, paneManga
      const paneId = 'pane' + name.charAt(0).toUpperCase() + name.slice(1);
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === paneId));
    });
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.textContent = '↻ Loading…';
    await loadAnime();
    await loadManga();
    await loadCharacters();
    await loadGames();
    btn.disabled = false;
    btn.textContent = '↻ Refresh Data';
    toast('Data refreshed');
  });

  // Generate pack
  document.getElementById('generateBtn').addEventListener('click', () => {
    const hasData = S.anime.length || S.characters.length || S.manga.length || S.games.length;
    if (!hasData) { toast('Wait for data to load first'); return; }
    const pack = generatePack();
    document.getElementById('packGrid').innerHTML =
      pack.map((item, i) => cardTask(item, i + 1)).join('');
    toast(`Pack generated — ${pack.length} niches`);
  });

  // Copy
  document.getElementById('copyBtn').addEventListener('click', () => {
    if (!S.pack.length) { toast('Generate a pack first'); return; }
    navigator.clipboard.writeText(packToText())
      .then(() => toast('Copied to clipboard'))
      .catch(() => toast('Copy failed — use Export JSON'));
  });

  // Export JSON
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!S.pack.length) { toast('Generate a pack first'); return; }
    const blob = new Blob([packToJSON()], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href:     url,
      download: `fetchanime-pack-${NOW.getFullYear()}-${String(NOW.getMonth()+1).padStart(2,'0')}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
    toast('JSON exported');
  });

  // Save names (.txt — one character name per line, for generation)
  document.getElementById('saveNamesBtn').addEventListener('click', async () => {
    if (!S.pack.length) { toast('Generate a pack first'); return; }
    const btn  = document.getElementById('saveNamesBtn');
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Resolving…';
    try {
      const text = await packToNames();
      if (!text) { toast('No names resolved'); return; }
      const blob = new Blob([text + '\n'], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), {
        href:     url,
        download: `fetchanime-names-${NOW.getFullYear()}-${String(NOW.getMonth()+1).padStart(2,'0')}.txt`,
      });
      a.click();
      URL.revokeObjectURL(url);
      toast(`Saved ${text.split('\n').length} names`);
    } catch (e) {
      toast(`Save failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });
}

async function init() {
  initUI();
  // AniList: sequential to avoid burst rate limits; RAWG can run in parallel
  await loadAnime();
  await loadManga();
  await loadCharacters();
  await loadGames();
}

document.addEventListener('DOMContentLoaded', init);
