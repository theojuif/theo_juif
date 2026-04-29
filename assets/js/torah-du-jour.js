/**
 * torah-du-jour.js
 *
 * Sources :
 *  - Français : bolls.life /get-text/LSG/{book}/{chapter}/{verse}/
 *  - Hébreu   : Sefaria API v2 (optionnel)
 *
 * Le nombre exact de versets par chapitre est embarqué dans le code
 * → aucune chance de demander un verset hors limites.
 */

(function () {
  "use strict";

  // ─── Nombre de versets par chapitre (Torah complète) ──────────────────────
  // Source : https://www.sefaria.org (comptage massorétique standard)
  // Format : VERSES[bollsBookNumber] = [v_ch1, v_ch2, ...]
  const VERSES = {
    1: [ // Genèse
      31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,
      34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,
      57,38,34,34,28,34,31,22,33,26
    ],
    2: [ // Exode
      22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,
      36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38
    ],
    3: [ // Lévitique
      17,16,17,35,19,30,38,36,24,20,47, 8,59,57,33,34,16,30,24,33,
      3,49,17,10,22,28,23,51,31,30,32,22,31,19,39,12,25,23,29
    ],
    4: [ // Nombres
      54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,
      35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13
    ],
    5: [ // Deutéronome
      46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,
      23,30,25,22,19,19,26,68,29,20,30,52,29,12
    ],
  };

  const TORAH_BOOKS = [
    { name: "Genesis",     bollsBook: 1, sefariaRef: "Genesis"    },
    { name: "Exodus",      bollsBook: 2, sefariaRef: "Exodus"     },
    { name: "Leviticus",   bollsBook: 3, sefariaRef: "Leviticus"  },
    { name: "Numbers",     bollsBook: 4, sefariaRef: "Numbers"    },
    { name: "Deuteronomy", bollsBook: 5, sefariaRef: "Deuteronomy"},
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

  // ─── Nettoyage texte ──────────────────────────────────────────────────────

  function stripHtml(raw) {
    if (!raw) return "";
    return raw.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
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
    raw = raw.replace(/[\u0591-\u05AF\u05BE\u05C0\u05C3\u05C6\u05C7]/g, "");
    return raw.replace(/\s{2,}/g, " ").trim();
  }

  // ─── Sélection déterministe ───────────────────────────────────────────────

  function pickTarget(seed) {
    const rand = seededRng(seed);

    // Choisir un livre proportionnellement au nombre total de versets
    const totalVerses = Object.values(VERSES).reduce(
      (sum, chapters) => sum + chapters.reduce((a, b) => a + b, 0), 0
    );
    let r = rand() * totalVerses;
    let chosenBook = TORAH_BOOKS[TORAH_BOOKS.length - 1];
    for (const book of TORAH_BOOKS) {
      const bookTotal = VERSES[book.bollsBook].reduce((a, b) => a + b, 0);
      r -= bookTotal;
      if (r <= 0) { chosenBook = book; break; }
    }

    // Choisir un chapitre proportionnellement au nombre de versets
    const chapVerses = VERSES[chosenBook.bollsBook];
    const chTotal    = chapVerses.reduce((a, b) => a + b, 0);
    let rv = rand() * chTotal;
    let chapter = chapVerses.length; // fallback = dernier chapitre
    for (let i = 0; i < chapVerses.length; i++) {
      rv -= chapVerses[i];
      if (rv <= 0) { chapter = i + 1; break; }
    }

    // Choisir un verset — index garanti dans les limites
    const maxVerse = chapVerses[chapter - 1];
    const verse    = 1 + Math.floor(rand() * maxVerse);

    return { book: chosenBook, chapter, verse };
  }

  // ─── API bolls.life ───────────────────────────────────────────────────────

  async function fetchFrench(bollsBook, chapter, verse) {
    const url = `https://bolls.life/get-text/LSG/${bollsBook}/${chapter}/${verse}/`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bolls.life HTTP ${res.status}`);
    const data = await res.json();
    const text = stripHtml(data.text || "");
    if (!text) throw new Error("Texte vide (LSG).");
    return { verseNumber: data.verse || verse, text };
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

  // ─── Orchestration ────────────────────────────────────────────────────────

  async function fetchVerse(book, chapter, verse) {
    const fr     = await fetchFrench(book.bollsBook, chapter, verse);
    const heText = await fetchHebrew(book.sefariaRef, chapter, fr.verseNumber);
    return { book: book.name, chapter, verse: fr.verseNumber, he: heText, fr: fr.text };
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
    const { book, chapter, verse } = pickTarget(dateToSeed(date));
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
