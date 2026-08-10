// Endpoint API : GET /api/torah-du-jour
// Renvoie le verset du jour au format JSON.
//
// Query params optionnels :
//   ?date=YYYY-MM-DD   → renvoie le verset calculé pour cette date (jamais dans le futur)
//
// Réutilise exactement le même algorithme déterministe que assets/js/torah-du-jour.js
// (même seed = même verset, que ce soit calculé côté navigateur ou ici côté serveur).

const fs = require('fs');
const path = require('path');

// ─── Configuration (identique à torah-du-jour.js) ──────────────────────────

const TORAH_BOOKS = [
  { name: "Genesis",     jsonIndex: 0, sefariaRef: "Genesis"     },
  { name: "Exodus",      jsonIndex: 1, sefariaRef: "Exodus"      },
  { name: "Leviticus",   jsonIndex: 2, sefariaRef: "Leviticus"   },
  { name: "Numbers",     jsonIndex: 3, sefariaRef: "Numbers"     },
  { name: "Deuteronomy", jsonIndex: 4, sefariaRef: "Deuteronomy" },
];

const BOOK_NAMES_FR = {
  Genesis:     "Bereshit · Genèse",
  Exodus:      "Shemot · Exode",
  Leviticus:   "Vayikra · Lévitique",
  Numbers:     "Bamidbar · Nombres",
  Deuteronomy: "Devarim · Deutéronome",
};

let bibleCache = null;

function loadBibleData() {
  if (bibleCache) return bibleCache;
  const filePath = path.join(process.cwd(), 'assets', 'js', 'fr_apee.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  bibleCache = JSON.parse(raw);
  return bibleCache;
}

// ─── PRNG déterministe (mulberry32) — identique au script client ──────────

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dateToSeed(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return parseInt(`${y}${m}${d}`, 10);
}

function localMidnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Sélection déterministe du verset ──────────────────────────────────────

function pickTarget(seed, bible) {
  const rand = seededRng(seed);

  let totalVerses = 0;
  for (const book of TORAH_BOOKS) {
    for (const chapter of bible[book.jsonIndex].chapters) {
      totalVerses += chapter.length;
    }
  }

  let pos = Math.floor(rand() * totalVerses);

  for (const book of TORAH_BOOKS) {
    const chapters = bible[book.jsonIndex].chapters;
    for (let ci = 0; ci < chapters.length; ci++) {
      if (pos < chapters[ci].length) {
        return {
          book,
          chapter: ci + 1,
          verseIndex: pos,
          verseNumber: pos + 1,
        };
      }
      pos -= chapters[ci].length;
    }
  }

  return { book: TORAH_BOOKS[0], chapter: 1, verseIndex: 0, verseNumber: 1 };
}

function getFrenchVerse(bible, bookJsonIndex, chapter, verseIndex) {
  const text = bible[bookJsonIndex].chapters[chapter - 1][verseIndex];
  return text || "";
}

// ─── Nettoyage hébreu Sefaria ───────────────────────────────────────────────

function cleanHebrew(raw) {
  if (!raw) return "";
  if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");
  raw = raw.replace(/<[^>]+>/g, " ");
  raw = raw
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&thinsp;/g, "\u2009")
    .replace(/&#x[\da-fA-F]+;/g, m => String.fromCodePoint(parseInt(m.slice(3, -1), 16)))
    .replace(/&#\d+;/g,           m => String.fromCodePoint(parseInt(m.slice(2, -1), 10)));
  raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
  return raw.replace(/\s{2,}/g, " ").trim();
}

async function fetchHebrew(sefariaRef, chapter, verse) {
  try {
    const ref = `${sefariaRef}.${chapter}.${verse}`;
    const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0`;
    const res = await fetch(url);
    if (!res.ok) return "";
    const data = await res.json();
    if (data.error) return "";
    return cleanHebrew(data.he) || "";
  } catch (_) {
    return "";
  }
}

// ─── Utilitaires requête ────────────────────────────────────────────────────

function parseDateParam(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isNaN(d.getTime()) ? null : localMidnight(d);
}

// ─── Handler Vercel ──────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Autorise n'importe quel autre programme/site à appeler cette API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const today = localMidnight(new Date());
    const date = parseDateParam(req.query.date) || today;

    if (date > today) {
      res.status(400).json({ error: "La date demandée est dans le futur." });
      return;
    }

    const bible    = loadBibleData();
    const target   = pickTarget(dateToSeed(date), bible);
    const francais = getFrenchVerse(bible, target.book.jsonIndex, target.chapter, target.verseIndex);
    const hebreu   = await fetchHebrew(target.book.sefariaRef, target.chapter, target.verseNumber);

    const bookFr = BOOK_NAMES_FR[target.book.name] || target.book.name;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      date: date.toISOString().slice(0, 10),
      livre: bookFr,
      chapitre: target.chapter,
      verset: target.verseNumber,
      reference: `${bookFr.split(' · ')[1] || bookFr} ${target.chapter}:${target.verseNumber}`,
      hebreu,
      francais,
      lien_sefaria: `https://www.sefaria.org/${target.book.sefariaRef}.${target.chapter}.${target.verseNumber}?lang=bi`,
    });
  } catch (e) {
    console.error('[api/torah-du-jour]', e);
    res.status(500).json({ error: "Erreur serveur lors du calcul du verset." });
  }
};
