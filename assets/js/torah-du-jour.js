/**
 * torah-du-jour.js
 * Verset du jour depuis l'API Sefaria.
 *
 * Stratégie API :
 *  1. Appel v2 pour le texte hébreu (fiable, simple)
 *  2. Appel v3 séparé pour tenter la traduction française
 *  3. Fallback sur la traduction anglaise si le FR échoue
 */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────────────────────

  const TORAH_BOOKS = [
    { ref: "Genesis",     chapters: 50 },
    { ref: "Exodus",      chapters: 40 },
    { ref: "Leviticus",   chapters: 27 },
    { ref: "Numbers",     chapters: 36 },
    { ref: "Deuteronomy", chapters: 34 },
  ];

  const BOOK_NAMES_FR = {
    Genesis:     "Bereshit · Genèse",
    Exodus:      "Shemot · Exode",
    Leviticus:   "Vayikra · Lévitique",
    Numbers:     "Bamidbar · Nombres",
    Deuteronomy: "Devarim · Deutéronome",
  };

  const MAX_VERSE_HINT = 25;

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

  // ─── Nettoyage du texte Sefaria ───────────────────────────────────────────

  function cleanText(raw) {
    if (!raw) return "";
    if (Array.isArray(raw)) raw = raw.flat(Infinity).join(" ");

    // Retirer les balises HTML
    raw = raw.replace(/<[^>]+>/g, " ");

    // Décoder les entités HTML
    raw = raw
      .replace(/&amp;/g,   "&")
      .replace(/&lt;/g,    "<")
      .replace(/&gt;/g,    ">")
      .replace(/&nbsp;/g,  " ")
      .replace(/&thinsp;/g,"\u2009")
      .replace(/&#x[\da-fA-F]+;/g, (m) =>
        String.fromCodePoint(parseInt(m.slice(3, -1), 16))
      )
      .replace(/&#\d+;/g, (m) =>
        String.fromCodePoint(parseInt(m.slice(2, -1), 10))
      );

    // Retirer les accents de cantillation (U+0591–U+05AF)
    // et la ponctuation massorétique problématique
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");

    // Nettoyer les espaces multiples
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  // ─── Sélection aléatoire du verset ───────────────────────────────────────

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
    const verse   = 1 + Math.floor(rand() * MAX_VERSE_HINT);
    return { book: book.ref, chapter, verse };
  }

  // ─── Appels API Sefaria ───────────────────────────────────────────────────

  /**
   * Appel principal : API v2 (la plus stable).
   * Retourne le texte hébreu ET la traduction par défaut (EN).
   */
  async function fetchMain(ref) {
    const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Appel secondaire : tente de récupérer la traduction française via v3.
   * Ne lève jamais d'exception — retourne "" en cas d'échec.
   */
  async function fetchFrench(ref) {
    try {
      // On demande uniquement la version française
      const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=fr&fill_in_missing_segments=1`;
      const res = await fetch(url);
      if (!res.ok) return "";
      const data = await res.json();
      if (!data.versions || data.versions.length === 0) return "";
      for (const v of data.versions) {
        const lang = (v.actualLanguage || v.language || "").toLowerCase();
        if (lang === "fr") {
          const t = cleanText(v.text);
          if (t) return t;
        }
      }
      return "";
    } catch (_) {
      return "";
    }
  }

  /**
   * Orchestre les deux appels et construit l'objet verset final.
   * Retente avec le verset 1 si le verset demandé n'existe pas.
   */
  async function fetchVerse(book, chapter, verseHint, isRetry) {
    const ref = `${book}.${chapter}.${verseHint}`;

    const data = await fetchMain(ref);

    // Sefaria renvoie un champ "error" si la référence est invalide
    if (data.error) {
      if (!isRetry) return fetchVerse(book, chapter, 1, true);
      throw new Error(data.error);
    }

    const heText = cleanText(data.he);
    const enText = cleanText(data.text);

    // Texte hébreu vide = verset hors limites
    if (!heText && !isRetry) return fetchVerse(book, chapter, 1, true);
    if (!heText) throw new Error("Verset introuvable.");

    // Tentative de traduction française (en parallèle avec ce qu'on a déjà)
    const frText = await fetchFrench(ref);

    const translation     = frText || enText;
    const translationLang = frText ? "fr" : (enText ? "en" : "");

    // Numéro de verset réel renvoyé par Sefaria
    const realVerse = data.sections
      ? data.sections[data.sections.length - 1]
      : verseHint;

    return { book, chapter, verse: realVerse, he: heText, translation, translationLang };
  }

  // ─── Rendu DOM ────────────────────────────────────────────────────────────

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
    const bookFr    = BOOK_NAMES_FR[verseData.book] || verseData.book;
    const langLabel = verseData.translationLang === "fr"
      ? "Traduction française · André Chouraqui"
      : "Traduction · anglais";

    el("tdj-date").textContent        = formatDateFr(date);
    el("tdj-ref").textContent         =
      `${bookFr} — chapitre ${verseData.chapter}, verset ${verseData.verse}`;
    el("tdj-he").textContent          = verseData.he;
    el("tdj-translation").textContent = verseData.translation;
    el("tdj-label").textContent       = langLabel;
    el("tdj-label").style.display     = verseData.translation ? "block" : "none";
    el("tdj-error").style.display     = "none";
    el("tdj-content").classList.remove("tdj-loading");
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  let currentDate;
  let today;

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
    const seed   = dateToSeed(date);
    const picked = pickVerse(seed);
    try {
      const verseData = await fetchVerse(picked.book, picked.chapter, picked.verse, false);
      renderVerse(verseData, date);
    } catch (e) {
      setError("Impossible de charger le verset. Vérifiez votre connexion et rechargez la page.");
      console.error("[torah-du-jour]", e);
    }
  }

  function navigate(deltaDays) {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + deltaDays);
    const nextMidnight = localMidnight(next);
    if (nextMidnight > today) return;
    currentDate = nextMidnight;
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
