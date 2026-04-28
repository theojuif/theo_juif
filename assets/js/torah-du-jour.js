/**
 * torah-du-jour.js
 * Génère un verset aléatoire de la Torah basé sur la date.
 * Même date = même verset. Jours futurs bloqués. Navigation vers le passé possible.
 */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────────────────────
  // Livres de la Torah (Pentateuque) avec leur nombre de chapitres
  const TORAH_BOOKS = [
    { ref: "Genesis",     chapters: 50 },
    { ref: "Exodus",      chapters: 40 },
    { ref: "Leviticus",   chapters: 27 },
    { ref: "Numbers",     chapters: 36 },
    { ref: "Deuteronomy", chapters: 34 },
  ];

  const BOOK_NAMES_FR = {
    Genesis:     "Bereshit (Genèse)",
    Exodus:      "Shemot (Exode)",
    Leviticus:   "Vayikra (Lévitique)",
    Numbers:     "Bamidbar (Nombres)",
    Deuteronomy: "Devarim (Deutéronome)",
  };

  // Nombre approximatif de versets par chapitre (max safe)
  const MAX_VERSES = 30;

  // ─── Utilitaires ──────────────────────────────────────────────────────────

  /**
   * PRNG déterministe (mulberry32) à partir d'un seed numérique.
   * Retourne une fonction rand() -> [0, 1)
   */
  function seededRng(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Convertit une date en seed numérique reproductible (YYYYMMDD).
   */
  function dateToSeed(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return parseInt(`${y}${m}${d}`, 10);
  }

  /**
   * Retourne la date locale sans l'heure (minuit).
   */
  function localMidnight(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Formate une date en français (ex: "lundi 28 avril 2025")
   */
  function formatDateFr(date) {
    return date.toLocaleDateString("fr-FR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  /**
   * Choisit un verset aléatoire à partir d'un seed.
   * Retourne { book, chapter, verse }
   */
  function pickVerse(seed) {
    const rand = seededRng(seed);

    // 1. Choisir un livre (pondéré par nombre de chapitres)
    const totalChapters = TORAH_BOOKS.reduce((a, b) => a + b.chapters, 0);
    let r = rand() * totalChapters;
    let book = TORAH_BOOKS[TORAH_BOOKS.length - 1];
    for (const b of TORAH_BOOKS) {
      r -= b.chapters;
      if (r <= 0) { book = b; break; }
    }

    // 2. Choisir un chapitre
    const chapter = 1 + Math.floor(rand() * book.chapters);

    // 3. Choisir un verset (on utilisera 1-MAX_VERSES, Sefaria gérera si hors limite)
    const verse = 1 + Math.floor(rand() * MAX_VERSES);

    return { book: book.ref, chapter, verse };
  }

  // ─── Appel API Sefaria ────────────────────────────────────────────────────

  /**
   * Récupère un verset via l'API Sefaria.
   * Si le verset demandé est hors limite, on récupère le chapitre et on prend le dernier verset.
   */
  async function fetchVerse(book, chapter, verseHint) {
    // D'abord on tente le verset exact
    const ref = `${book}.${chapter}.${verseHint}`;
    const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?lang=he&commentary=0&context=0`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Si le texte est vide ou erreur Sefaria, fallback sur verset 1
    const heText = Array.isArray(data.he) ? data.he.join(" ") : data.he;
    const enText = Array.isArray(data.text) ? data.text.join(" ") : data.text;

    if (!heText && !enText) {
      // Fallback : verset 1 du même chapitre
      return fetchVerse(book, chapter, 1);
    }

    return {
      ref:    data.ref || ref,
      he:     heText   || "",
      en:     enText   || "",
      book,
      chapter,
      verse:  data.sections ? data.sections[data.sections.length - 1] : verseHint,
    };
  }

  // ─── Rendu DOM ────────────────────────────────────────────────────────────

  function setLoading() {
    document.getElementById("tdj-date").textContent     = "Chargement…";
    document.getElementById("tdj-ref").textContent      = "";
    document.getElementById("tdj-he").textContent       = "";
    document.getElementById("tdj-en").textContent       = "";
    document.getElementById("tdj-fr-label").style.display = "none";
    document.getElementById("tdj-error").style.display  = "none";
    document.getElementById("tdj-content").classList.add("tdj-loading");
  }

  function setError(msg) {
    document.getElementById("tdj-error").textContent   = msg;
    document.getElementById("tdj-error").style.display = "block";
    document.getElementById("tdj-content").classList.remove("tdj-loading");
    document.getElementById("tdj-date").textContent    = "";
  }

  function renderVerse(verseData, date) {
    const bookFr = BOOK_NAMES_FR[verseData.book] || verseData.book;
    document.getElementById("tdj-date").textContent = formatDateFr(date);
    document.getElementById("tdj-ref").textContent  =
      `${bookFr} — chapitre ${verseData.chapter}, verset ${verseData.verse}`;
    document.getElementById("tdj-he").textContent   = verseData.he;
    document.getElementById("tdj-en").textContent   = verseData.en;
    document.getElementById("tdj-fr-label").style.display = "block";
    document.getElementById("tdj-content").classList.remove("tdj-loading");
    document.getElementById("tdj-error").style.display = "none";
  }

  // ─── Logique principale ───────────────────────────────────────────────────

  // Date courante affichée (modifiée par navigation)
  let currentDate = localMidnight(new Date());
  const today     = localMidnight(new Date());

  async function loadVerse(date) {
    setLoading();
    updateNavButtons(date);

    const seed   = dateToSeed(date);
    const picked = pickVerse(seed);

    try {
      const verseData = await fetchVerse(picked.book, picked.chapter, picked.verse);
      renderVerse(verseData, date);
    } catch (e) {
      setError("Impossible de charger le verset. Vérifiez votre connexion et rechargez la page.");
      console.error("Sefaria API error:", e);
    }
  }

  function updateNavButtons(date) {
    const prevBtn = document.getElementById("tdj-prev");
    const nextBtn = document.getElementById("tdj-next");
    const todayBtn = document.getElementById("tdj-today");

    if (prevBtn) prevBtn.disabled = false; // on peut toujours aller en arrière

    if (nextBtn) {
      // Bloquer si la date suivante serait dans le futur
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      nextBtn.disabled = localMidnight(nextDay) > today;
    }

    if (todayBtn) {
      todayBtn.disabled = date.getTime() === today.getTime();
    }
  }

  function navigate(deltaDays) {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + deltaDays);
    const nextMidnight = localMidnight(next);

    if (nextMidnight > today) return; // sécurité : pas de futur

    currentDate = nextMidnight;
    loadVerse(currentDate);
  }

  // ─── Initialisation ───────────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    // Boutons de navigation
    const prevBtn  = document.getElementById("tdj-prev");
    const nextBtn  = document.getElementById("tdj-next");
    const todayBtn = document.getElementById("tdj-today");

    if (prevBtn)  prevBtn.addEventListener("click",  () => navigate(-1));
    if (nextBtn)  nextBtn.addEventListener("click",  () => navigate(+1));
    if (todayBtn) todayBtn.addEventListener("click", () => {
      currentDate = localMidnight(new Date());
      loadVerse(currentDate);
    });

    // Chargement initial
    loadVerse(currentDate);
  });

})();
