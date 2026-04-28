/**
 * torah-du-jour.js
 *
 * Deux sources :
 *  - Hébreu  : API Sefaria (texte massorétique, fiable)
 *  - Français : API bible.helloao.org – Louis Segond 1910 (LSG)
 *               domaine public, Torah complète, "l'Éternel" pour le nom divin
 *
 * Seed déterministe : même date = même verset. Jours futurs bloqués.
 */

(function () {
  "use strict";

  // ─── Torah books ──────────────────────────────────────────────────────────

  // Livres avec leur nombre de chapitres ET leur identifiant LSG (helloao.org)
  const TORAH_BOOKS = [
    { ref: "Genesis",     lsg: "GEN", chapters: 50 },
    { ref: "Exodus",      lsg: "EXO", chapters: 40 },
    { ref: "Leviticus",   lsg: "LEV", chapters: 27 },
    { ref: "Numbers",     lsg: "NUM", chapters: 36 },
    { ref: "Deuteronomy", lsg: "DEU", chapters: 34 },
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
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // ─── Nettoyage texte Sefaria ──────────────────────────────────────────────

  function cleanHebrew(raw) {
    if (!raw) return "";
    if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");
    raw = raw.replace(/<[^>]+>/g, " ");
    raw = raw
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").replace(/&thinsp;/g, "\u2009")
      .replace(/&#x[\da-fA-F]+;/g, m => String.fromCodePoint(parseInt(m.slice(3,-1),16)))
      .replace(/&#\d+;/g, m => String.fromCodePoint(parseInt(m.slice(2,-1),10)));
    // Retire cantillations (U+0591–U+05AF) + ponctuation massorétique parasites
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  // ─── Sélection aléatoire ──────────────────────────────────────────────────

  /**
   * Retourne { book, chapter, verseIndex }
   * verseIndex est un indice 0-based dans le tableau des versets du chapitre.
   * On ne connaît pas le nombre exact de versets avant d'appeler l'API LSG,
   * donc on tire un nombre entre 0 et 29 (les chapitres ont rarement + de 30v).
   * Si l'indice dépasse la longueur réelle, on prend le dernier verset.
   */
  function pickVerse(seed) {
    const rand = seededRng(seed);
    const totalChapters = TORAH_BOOKS.reduce((a, b) => a + b.chapters, 0);
    let r = rand() * totalChapters;
    let book = TORAH_BOOKS[TORAH_BOOKS.length - 1];
    for (const b of TORAH_BOOKS) {
      r -= b.chapters;
      if (r <= 0) { book = b; break; }
    }
    const chapter    = 1 + Math.floor(rand() * book.chapters);
    const verseIndex = Math.floor(rand() * 30); // 0-based, clampé après appel API
    return { book, chapter, verseIndex };
  }

  // ─── API 1 : Hébreu via Sefaria ───────────────────────────────────────────

  async function fetchHebrew(bookRef, chapter, verseNumber) {
    const ref = `${bookRef}.${chapter}.${verseNumber}`;
    const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sefaria HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return cleanHebrew(data.he);
  }

  // ─── API 2 : Français via bible.helloao.org (LSG 1910) ───────────────────

  /**
   * Récupère tout le chapitre d'un coup (plus efficace que verset par verset).
   * Retourne un tableau de { number, text }.
   */
  async function fetchChapterLSG(lsgId, chapter) {
    const url = `https://bible.helloao.org/api/LSG/${lsgId}/${chapter}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`LSG HTTP ${res.status}`);
    const data = await res.json();

    // La réponse helloao v2 : data.verses = [{ number, content: [{type,text}] }]
    const verses = [];
    for (const v of (data.verses || [])) {
      // Concaténer tous les fragments de texte du verset
      let text = "";
      for (const block of (v.content || [])) {
        if (block.type === "verse_start" || block.type === "verse_end") continue;
        if (typeof block.text === "string") text += block.text;
        if (typeof block     === "string") text += block;
      }
      text = text.trim();
      if (text) verses.push({ number: v.number, text });
    }
    return verses;
  }

  // ─── Orchestration principale ─────────────────────────────────────────────

  async function fetchVerse(book, chapter, verseIndex) {
    // 1. Récupérer le chapitre en français (LSG)
    const verses = await fetchChapterLSG(book.lsg, chapter);
    if (!verses.length) throw new Error("Chapitre introuvable (LSG).");

    // 2. Clamp l'index si besoin
    const idx    = Math.min(verseIndex, verses.length - 1);
    const picked = verses[idx];

    // 3. Récupérer le texte hébreu du même verset via Sefaria
    let heText = "";
    try {
      heText = await fetchHebrew(book.ref, chapter, picked.number);
    } catch (e) {
      console.warn("[torah-du-jour] Hébreu indisponible :", e.message);
    }

    return {
      book:        book.ref,
      chapter,
      verse:       picked.number,
      he:          heText,
      translation: picked.text,
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

  function renderVerse(verseData, date) {
    const bookFr = BOOK_NAMES_FR[verseData.book] || verseData.book;
    el("tdj-date").textContent        = formatDateFr(date);
    el("tdj-ref").textContent         =
      `${bookFr} — chapitre ${verseData.chapter}, verset ${verseData.verse}`;
    el("tdj-he").textContent          = verseData.he || "";
    el("tdj-translation").textContent = verseData.translation;
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
    const { book, chapter, verseIndex } = pickVerse(dateToSeed(date));
    try {
      const verseData = await fetchVerse(book, chapter, verseIndex);
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
