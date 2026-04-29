/**
 * torah-du-jour.js
 *
 * Sources :
 *  - Français : fr_apee.json (chargé localement, zéro dépendance externe)
 *    Structure : array[bookIndex].chapters[chapterIndex][verseIndex]
 *    Livres Torah : index 0=Genèse, 1=Exode, 2=Lévitique, 3=Nombres, 4=Deutéronome
 *
 *  - Hébreu : Sefaria API v2 (optionnel, ne bloque jamais)
 *
 * Seed déterministe : même date → même verset. Jours futurs bloqués.
 */

(function () {
  "use strict";

  // ─── Configuration ────────────────────────────────────────────────────────

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

  // Chemin vers le fichier JSON (même dossier que ce script)
  const JSON_URL = "assets/js/fr_apee.json";

  // Cache du JSON pour éviter de le recharger à chaque navigation
  let bibleData = null;

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
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ").replace(/&thinsp;/g, "\u2009")
      .replace(/&#x[\da-fA-F]+;/g, m => String.fromCodePoint(parseInt(m.slice(3,-1), 16)))
      .replace(/&#\d+;/g,           m => String.fromCodePoint(parseInt(m.slice(2,-1), 10)));
    // Retire cantillations (U+0591–U+05AF) et ponctuation massorétique parasites
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  // ─── Chargement du JSON local ─────────────────────────────────────────────

  async function loadBibleData() {
    if (bibleData) return bibleData;
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`Impossible de charger ${JSON_URL} (HTTP ${res.status})`);
    bibleData = await res.json();
    return bibleData;
  }

  // ─── Sélection déterministe ───────────────────────────────────────────────

  /**
   * Utilise les vraies données du JSON pour calculer les proportions.
   * Aucun risque d'index hors limites.
   */
  function pickTarget(seed, bible) {
    const rand = seededRng(seed);

    // Compter le total de versets dans la Torah (5 premiers livres)
    let totalVerses = 0;
    for (const book of TORAH_BOOKS) {
      for (const chapter of bible[book.jsonIndex].chapters) {
        totalVerses += chapter.length;
      }
    }

    // Choisir un verset par position absolue
    let pos = Math.floor(rand() * totalVerses);

    for (const book of TORAH_BOOKS) {
      const chapters = bible[book.jsonIndex].chapters;
      for (let ci = 0; ci < chapters.length; ci++) {
        if (pos < chapters[ci].length) {
          return {
            book,
            chapter:    ci + 1,           // 1-based
            verseIndex: pos,              // 0-based dans le tableau
            verseNumber: pos + 1,         // 1-based pour l'affichage / Sefaria
          };
        }
        pos -= chapters[ci].length;
      }
    }

    // Fallback (ne devrait jamais arriver)
    return { book: TORAH_BOOKS[0], chapter: 1, verseIndex: 0, verseNumber: 1 };
  }

  // ─── Récupération du texte français ──────────────────────────────────────

  function getFrenchVerse(bible, bookJsonIndex, chapter, verseIndex) {
    const text = bible[bookJsonIndex].chapters[chapter - 1][verseIndex];
    return text || "";
  }

  // ─── API Sefaria (hébreu, optionnel) ─────────────────────────────────────

  async function fetchHebrew(sefariaRef, chapter, verse) {
    try {
      const ref = `${sefariaRef}.${chapter}.${verse}`;
      const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0`;
      const res = await fetch(url);
      if (!res.ok) return "";
      const data = await res.json();
      if (data.error) return "";
      return cleanHebrew(data.he) || "";
    } catch (_) { return ""; }
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
    const bookFr = BOOK_NAMES_FR[v.book.name] || v.book.name;
    const bookShort = bookFr.split(" · ")[1] || bookFr;

    el("tdj-date").textContent        = formatDateFr(date);
    el("tdj-ref").textContent         =
      `${bookFr} — chapitre ${v.chapter}, verset ${v.verseNumber}`;
    el("tdj-he").textContent          = v.he;
    el("tdj-translation").textContent = v.fr;
    el("tdj-label").textContent       = "Traduction française";
    el("tdj-label").style.display     = "block";
    el("tdj-error").style.display     = "none";

    // Lien de contexte vers Sefaria
    const linkEl = el("tdj-context-link");
    if (linkEl) {
      linkEl.href        = `https://www.sefaria.org/${v.book.sefariaRef}.${v.chapter}.${v.verseNumber}?lang=bi`;
      linkEl.textContent = `Lire ${bookShort} ${v.chapter} en contexte →`;
      linkEl.style.display = "inline";
    }

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
    try {
      const bible  = await loadBibleData();
      const target = pickTarget(dateToSeed(date), bible);
      const frText = getFrenchVerse(bible, target.book.jsonIndex, target.chapter, target.verseIndex);
      const heText = await fetchHebrew(target.book.sefariaRef, target.chapter, target.verseNumber);
      renderVerse({ book: target.book, chapter: target.chapter, verseNumber: target.verseNumber, fr: frText, he: heText }, date);
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
