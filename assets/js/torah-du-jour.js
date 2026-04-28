/**
 * torah-du-jour.js
 *
 * Sources :
 *  - Français : api.getbible.net/v2/lsg/{book}/{chapter}.json
 *    Retourne un objet { verses: { "1": {verse,text}, "2": {...}, ... } }
 *    On charge tout le chapitre → on sait exactement combien de versets il y a.
 *    Numéros de livres getbible : Genèse=1, Exode=2, Lévitique=3, Nombres=4, Deutéronome=5
 *
 *  - Hébreu : Sefaria API v2 (optionnel, ne bloque jamais)
 *
 * Seed déterministe : même date → même verset. Jours futurs bloqués.
 */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────────────────────

  const TORAH_BOOKS = [
    { name: "Genesis",     getBibleBook: 1, sefariaRef: "Genesis",     chapters: 50 },
    { name: "Exodus",      getBibleBook: 2, sefariaRef: "Exodus",      chapters: 40 },
    { name: "Leviticus",   getBibleBook: 3, sefariaRef: "Leviticus",   chapters: 27 },
    { name: "Numbers",     getBibleBook: 4, sefariaRef: "Numbers",     chapters: 36 },
    { name: "Deuteronomy", getBibleBook: 5, sefariaRef: "Deuteronomy", chapters: 34 },
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
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }

  // ─── Nettoyage hébreu Sefaria ─────────────────────────────────────────────

  function cleanHebrew(raw) {
    if (!raw) return "";
    if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");
    raw = raw.replace(/<[^>]+>/g, " ");
    raw = raw
      .replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">")
      .replace(/&nbsp;/g," ").replace(/&thinsp;/g,"\u2009")
      .replace(/&#x[\da-fA-F]+;/g, m => String.fromCodePoint(parseInt(m.slice(3,-1),16)))
      .replace(/&#\d+;/g, m => String.fromCodePoint(parseInt(m.slice(2,-1),10)));
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
    return raw.replace(/\s{2,}/g," ").trim();
  }

  // ─── Sélection ────────────────────────────────────────────────────────────

  // verseRatio ∈ [0,1) — sera multiplié par la taille réelle du chapitre
  function pickTarget(seed) {
    const rand = seededRng(seed);
    const totalChapters = TORAH_BOOKS.reduce((a,b) => a + b.chapters, 0);
    let r = rand() * totalChapters;
    let book = TORAH_BOOKS[TORAH_BOOKS.length - 1];
    for (const b of TORAH_BOOKS) { r -= b.chapters; if (r <= 0) { book = b; break; } }
    const chapter    = 1 + Math.floor(rand() * book.chapters);
    const verseRatio = rand();
    return { book, chapter, verseRatio };
  }

  // ─── API getbible.net — chapitre LSG complet ──────────────────────────────

  /**
   * GET https://api.getbible.net/v2/lsg/{book}/{chapter}.json
   *
   * Réponse attendue :
   * {
   *   "book_nr": 1, "chapter": 1,
   *   "verses": {
   *     "1": { "verse": 1, "text": "Au commencement..." },
   *     "2": { "verse": 2, "text": "La terre était..." },
   *     ...
   *   }
   * }
   *
   * On convertit verses en tableau trié par numéro de verset.
   */
  async function fetchChapterLSG(getBibleBook, chapter) {
    const url = `https://api.getbible.net/v2/lsg/${getBibleBook}/${chapter}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`getbible HTTP ${res.status} — livre ${getBibleBook} ch.${chapter}`);

    const data = await res.json();

    // Extraire et trier les versets
    const versesRaw = data.verses;
    if (!versesRaw || typeof versesRaw !== "object") {
      throw new Error(`Format inattendu (livre ${getBibleBook} ch.${chapter})`);
    }

    const verses = Object.values(versesRaw)
      .filter(v => v && v.text)
      .sort((a, b) => (a.verse || 0) - (b.verse || 0));

    if (verses.length === 0) {
      throw new Error(`Chapitre vide (livre ${getBibleBook} ch.${chapter})`);
    }

    return verses; // [{ verse: 1, text: "..." }, ...]
  }

  // ─── Sefaria — hébreu optionnel ───────────────────────────────────────────

  async function fetchHebrew(sefariaRef, chapter, verse) {
    try {
      const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(sefariaRef+"."+chapter+"."+verse)}?context=0&commentary=0`;
      const res = await fetch(url);
      if (!res.ok) return "";
      const data = await res.json();
      if (data.error) return "";
      return cleanHebrew(data.he) || "";
    } catch (_) { return ""; }
  }

  // ─── Orchestration ────────────────────────────────────────────────────────

  async function fetchVerse(book, chapter, verseRatio) {
    const verses = await fetchChapterLSG(book.getBibleBook, chapter);
    const idx    = Math.min(Math.floor(verseRatio * verses.length), verses.length - 1);
    const picked = verses[idx];

    const heText = await fetchHebrew(book.sefariaRef, chapter, picked.verse);

    return { book: book.name, chapter, verse: picked.verse, fr: picked.text, he: heText };
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
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    el("tdj-prev").disabled  = false;
    el("tdj-next").disabled  = localMidnight(next) > today;
    el("tdj-today").disabled = date.getTime() === today.getTime();
  }

  async function loadVerse(date) {
    setLoading(date);
    updateNavButtons(date);
    const { book, chapter, verseRatio } = pickTarget(dateToSeed(date));
    try {
      renderVerse(await fetchVerse(book, chapter, verseRatio), date);
    } catch (e) {
      setError("Impossible de charger le verset. Vérifiez votre connexion et rechargez la page.");
      console.error("[torah-du-jour]", e);
    }
  }

  function navigate(delta) {
    const next = localMidnight(new Date(currentDate));
    next.setDate(next.getDate() + delta);
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
    el("tdj-today").addEventListener("click", () => { currentDate = localMidnight(new Date()); loadVerse(currentDate); });
    loadVerse(currentDate);
  });

})();
