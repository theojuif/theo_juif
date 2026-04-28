/**
 * torah-du-jour.js
 *
 * Sources :
 *  - Français : bolls.life API — Louis Segond 1910 (LSG)
 *               Endpoint simple, fiable, sans clé, sans limite
 *               Numéros de livres : Genèse=1, Exode=2, Lévitique=3, Nombres=4, Deutéronome=5
 *
 *  - Hébreu : Sefaria API v2 — texte massorétique
 *
 * Seed déterministe : même date → même verset. Jours futurs bloqués.
 */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────────────────────

  // bollsBook : numéro de livre dans bolls.life (Ancien Testament commence à 1)
  // sefariaRef : nom du livre pour Sefaria
  // chapters : nombre de chapitres
  // versesPerChapter : estimation conservative (on sera toujours en dessous du max réel)
  const TORAH_BOOKS = [
    { name: "Genesis",     bollsBook: 1,  sefariaRef: "Genesis",     chapters: 50, maxVerse: 25 },
    { name: "Exodus",      bollsBook: 2,  sefariaRef: "Exodus",      chapters: 40, maxVerse: 25 },
    { name: "Leviticus",   bollsBook: 3,  sefariaRef: "Leviticus",   chapters: 27, maxVerse: 20 },
    { name: "Numbers",     bollsBook: 4,  sefariaRef: "Numbers",     chapters: 36, maxVerse: 25 },
    { name: "Deuteronomy", bollsBook: 5,  sefariaRef: "Deuteronomy", chapters: 34, maxVerse: 25 },
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

  // ─── Nettoyage hébreu Sefaria ─────────────────────────────────────────────

  function cleanHebrew(raw) {
    if (!raw) return "";
    if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");
    raw = raw.replace(/<[^>]+>/g, " ");
    raw = raw
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").replace(/&thinsp;/g, "\u2009")
      .replace(/&#x[\da-fA-F]+;/g, m => String.fromCodePoint(parseInt(m.slice(3,-1),16)))
      .replace(/&#\d+;/g, m => String.fromCodePoint(parseInt(m.slice(2,-1),10)));
    // Retire cantillations (U+0591–U+05AF) et ponctuation massorétique parasites
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  // ─── Sélection du verset ──────────────────────────────────────────────────

  function pickVerse(seed) {
    const rand = seededRng(seed);
    const totalChapters = TORAH_BOOKS.reduce((a, b) => a + b.chapters, 0);
    let r = rand() * totalChapters;
    let book = TORAH_BOOKS[TORAH_BOOKS.length - 1];
    for (const b of TORAH_BOOKS) {
      r -= b.chapters;
      if (r <= 0) { book = b; break; }
    }
    const chapter = 1 + Math.floor(rand() * book.chapters);
    const verse   = 1 + Math.floor(rand() * book.maxVerse);
    return { book, chapter, verse };
  }

  // ─── API bolls.life — Traduction française LSG ────────────────────────────

  /**
   * GET https://bolls.life/get-verse/LSG/{book}/{chapter}/{verse}/
   * Retourne : { pk, verse, text, comment }
   * Si le verset n'existe pas → retente avec verse=1
   */
  async function fetchFrench(bollsBook, chapter, verse, isRetry) {
    const url = `https://bolls.life/get-verse/LSG/${bollsBook}/${chapter}/${verse}/`;
    const res = await fetch(url);
    if (!res.ok) {
      if (!isRetry) return fetchFrench(bollsBook, chapter, 1, true);
      throw new Error(`bolls.life HTTP ${res.status}`);
    }
    const data = await res.json();

    // bolls.life renvoie du HTML dans le champ text — on le nettoie
    let text = data.text || "";
    text = text.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();

    if (!text) {
      if (!isRetry) return fetchFrench(bollsBook, chapter, 1, true);
      throw new Error("Verset vide (LSG).");
    }

    return { verseNumber: data.verse || verse, text };
  }

  // ─── API Sefaria — Texte hébreu ───────────────────────────────────────────

  /**
   * Ne lève jamais d'exception — retourne "" si indisponible.
   */
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

  async function fetchVerse(book, chapter, verse) {
    // 1. Français d'abord (source principale, ne doit pas échouer)
    const fr = await fetchFrench(book.bollsBook, chapter, verse, false);

    // 2. Hébreu en parallèle (optionnel)
    const heText = await fetchHebrew(book.sefariaRef, chapter, fr.verseNumber);

    return {
      book:    book.name,
      chapter,
      verse:   fr.verseNumber,
      he:      heText,
      fr:      fr.text,
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
    const { book, chapter, verse } = pickVerse(dateToSeed(date));
    try {
      const verseData = await fetchVerse(book, chapter, verse);
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
