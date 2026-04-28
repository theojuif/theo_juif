/**
 * torah-du-jour.js
 *
 * Sources :
 *  - Français : bolls.life API — Louis Segond 1910 (LSG)
 *    On charge tout le chapitre puis on y pioche le bon verset par index.
 *    Aucun risque de 404 "verset hors limites".
 *
 *  - Hébreu : Sefaria API v2 — texte massorétique (optionnel, ne bloque pas)
 *
 * Seed déterministe : même date → même verset. Jours futurs bloqués.
 */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────────────────────

  const TORAH_BOOKS = [
    { name: "Genesis",     bollsBook: 1, sefariaRef: "Genesis",     chapters: 50 },
    { name: "Exodus",      bollsBook: 2, sefariaRef: "Exodus",      chapters: 40 },
    { name: "Leviticus",   bollsBook: 3, sefariaRef: "Leviticus",   chapters: 27 },
    { name: "Numbers",     bollsBook: 4, sefariaRef: "Numbers",     chapters: 36 },
    { name: "Deuteronomy", bollsBook: 5, sefariaRef: "Deuteronomy", chapters: 34 },
  ];

  const BOOK_NAMES_FR = {
    Genesis:     "Bereshit · Genèse",
    Exodus:      "Shemot · Exode",
    Leviticus:   "Vayikra · Lévitique",
    Numbers:     "Bamidbar · Nombres",
    Deuteronomy: "Devarim · Deutéronome",
  };

  // ─── PRNG déterministe (mulberry32) ──────────────────────────────────────

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

  // ─── Utilitaires date ─────────────────────────────────────────────────────

  function localMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function formatDateFr(date) {
    return date.toLocaleDateString("fr-FR", {
      weekday: "long",
      year:    "numeric",
      month:   "long",
      day:     "numeric",
    });
  }

  // ─── Nettoyage texte ──────────────────────────────────────────────────────

  function stripHtml(raw) {
    if (!raw) return "";
    return raw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function cleanHebrew(raw) {
    if (!raw) return "";
    if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");
    raw = raw.replace(/<[^>]+>/g, " ");
    raw = raw
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").replace(/&thinsp;/g, "\u2009")
      .replace(/&#x[\da-fA-F]+;/g, m => String.fromCodePoint(parseInt(m.slice(3,-1), 16)))
      .replace(/&#\d+;/g,           m => String.fromCodePoint(parseInt(m.slice(2,-1), 10)));
    // Retire cantillations (U+0591–U+05AF) et ponctuation massorétique parasites
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  // ─── Sélection ────────────────────────────────────────────────────────────

  /**
   * Retourne { book, chapter, verseRatio }
   * verseRatio ∈ [0, 1) — sera multiplié par le vrai nombre de versets du chapitre.
   * On ne tire PAS un numéro de verset absolu ici pour éviter tout hors-limites.
   */
  function pickTarget(seed) {
    const rand = seededRng(seed);
    const totalChapters = TORAH_BOOKS.reduce((a, b) => a + b.chapters, 0);
    let r = rand() * totalChapters;
    let book = TORAH_BOOKS[TORAH_BOOKS.length - 1];
    for (const b of TORAH_BOOKS) {
      r -= b.chapters;
      if (r <= 0) { book = b; break; }
    }
    const chapter     = 1 + Math.floor(rand() * book.chapters);
    const verseRatio  = rand(); // 0 ≤ verseRatio < 1
    return { book, chapter, verseRatio };
  }

  // ─── API bolls.life — chapitre entier ─────────────────────────────────────

  /**
   * GET https://bolls.life/get-chapter/LSG/{book}/{chapter}/
   * Retourne un tableau de { pk, verse, text, comment }
   */
  async function fetchChapter(bollsBook, chapter) {
    const url = `https://bolls.life/get-chapter/LSG/${bollsBook}/${chapter}/`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bolls.life HTTP ${res.status} — livre ${bollsBook} ch.${chapter}`);
    const verses = await res.json();
    if (!Array.isArray(verses) || verses.length === 0) {
      throw new Error(`Chapitre vide (livre ${bollsBook}, ch.${chapter})`);
    }
    return verses;
  }

  // ─── API Sefaria — texte hébreu (optionnel) ───────────────────────────────

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

  // ─── Orchestration ────────────────────────────────────────────────────────

  async function fetchVerse(book, chapter, verseRatio) {
    // 1. Charger tout le chapitre — on sait maintenant combien de versets il y a
    const verses = await fetchChapter(book.bollsBook, chapter);

    // 2. Choisir un verset par ratio → jamais hors limites
    const idx    = Math.floor(verseRatio * verses.length);
    const picked = verses[Math.min(idx, verses.length - 1)];
    const verseNumber = picked.verse;
    const frText      = stripHtml(picked.text);

    // 3. Hébreu via Sefaria (ne bloque pas si indisponible)
    const heText = await fetchHebrew(book.sefariaRef, chapter, verseNumber);

    return {
      book:    book.name,
      chapter,
      verse:   verseNumber,
      he:      heText,
      fr:      frText,
    };
  }

  // ─── DOM ──────────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  function setLoading(date) {
    el("tdj-date").textContent        = formatDateFr(date);
    el("tdj-ref").textContent         = "Chargement…";
    el("tdj-he").textContent          = "";
    el("tdj-translation").textContent = "";
    el("tdj-label").style.display     = "none";
    el("tdj-error").style.display     = "none";
    el("tdj-content").classList.add("tdj-loading");
  }

  function setError(msg) {
    el("tdj-error").textContent   = msg;
    el("tdj-error").style.display = "block";
    el("tdj-ref").textContent     = "";
    el("tdj-content").classList.remove("tdj-loading");
  }

  function renderVerse(v, date) {
    el("tdj-date").textContent        = formatDateFr(date);
    el("tdj-ref").textContent         =
      `${BOOK_NAMES_FR[v.book] || v.book} — chapitre ${v.chapter}, verset ${v.verse}`;
    el("tdj-he").textContent          = v.he;
    el("tdj-translation").textContent = v.fr;
    el("tdj-label").textContent       = "Traduction française · Louis Segond 1910";
    el("tdj-label").style.display     = "block";
    el("tdj-error").style.display     = "none";
    el("tdj-content").classList.remove("tdj-loading");
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  let currentDate, today;

  function updateNavButtons(date) {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    el("tdj-prev").disabled  = false;
    el("tdj-next").disabled  = localMidnight(nextDay) > today;
    el("tdj-today").disabled = date.getTime() === today.getTime();
  }

  async function loadVerse(date) {
    setLoading(date);
    updateNavButtons(date);
    const { book, chapter, verseRatio } = pickTarget(dateToSeed(date));
    try {
      const verseData = await fetchVerse(book, chapter, verseRatio);
      renderVerse(verseData, date);
    } catch (e) {
      setError("Impossible de charger le verset. Vérifiez votre connexion et rechargez la page.");
      console.error("[torah-du-jour]", e);
    }
  }

  function navigate(deltaDays) {
    const next = localMidnight(new Date(currentDate));
    next.setDate(next.getDate() + deltaDays);
    if (next > today) return;
    currentDate = next;
    loadVerse(currentDate);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    today       = localMidnight(new Date());
    currentDate = localMidnight(new Date());
    el("tdj-prev").addEventListener("click",  () => navigate(-1));
    el("tdj-next").addEventListener("click",  () => navigate(+1));
    el("tdj-today").addEventListener("click", () => {
      currentDate = localMidnight(new Date());
      loadVerse(currentDate);
    });
    loadVerse(currentDate);
  });

})();
