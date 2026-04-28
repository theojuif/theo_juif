/**
 * torah-du-jour.js
 * Génère un verset aléatoire de la Torah basé sur la date.
 * Même date = même verset. Jours futurs bloqués. Navigation vers le passé possible.
 * Traduction française via Sefaria (Chouraqui), fallback anglais.
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
 
  // Versions Sefaria : "langue|Titre exact de la version"
  const FR_VERSION  = "fr|La bible d'André Chouraqui";
  const HE_VERSION  = "he|Tanach with Nikkud";
  const EN_FALLBACK = "en|The Contemporary Torah, JPS, 2006";
 
  const MAX_VERSES  = 30;
 
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
    const verse   = 1 + Math.floor(rand() * MAX_VERSES);
    return { book: book.ref, chapter, verse };
  }
 
  // ─── Nettoyage du texte hébreu ────────────────────────────────────────────
  // Supprime les accents de cantillation (te'amim, U+0591–U+05AF) qui causent
  // des artefacts visuels dans la plupart des polices web, en conservant
  // uniquement les consonnes et les points-voyelles (niqqud, U+05B0–U+05C7).
 
  function cleanHebrew(str) {
    if (!str) return "";
    return str
      .replace(/[\u0591-\u05AF]/g, "")     // te'amim (cantillation)
      .replace(/\u05BD/g, "")              // meteg
      .replace(/\u05BF/g, "")              // rafe
      .replace(/\u05C0/g, "")              // paseq
      .replace(/\u05C6/g, "")              // nun hafukha
      .replace(/[\u200B-\u200F\u200D]/g, " ") // zero-width / direction marks
      .replace(/\s+/g, " ")
      .trim();
  }
 
  function stripHtml(str) {
    if (!str) return "";
    return str.replace(/<[^>]+>/g, "").trim();
  }
 
  // ─── API Sefaria v3 ───────────────────────────────────────────────────────
 
  async function fetchVerse(book, chapter, verseHint) {
    const ref = `${book} ${chapter}:${verseHint}`;
 
    const [heRes, frRes] = await Promise.all([
      fetchVersion(ref, HE_VERSION),
      fetchVersion(ref, FR_VERSION),
    ]);
 
    // Si le verset hébreu est vide, le verset n'existe pas dans ce chapitre
    if (!heRes.text) {
      if (verseHint > 1) return fetchVerse(book, chapter, verseHint - 1);
      throw new Error(`Verset introuvable : ${ref}`);
    }
 
    let translation = frRes.text;
    let translationLang = "fr";
    if (!translation) {
      const enRes = await fetchVersion(ref, EN_FALLBACK);
      translation = enRes.text;
      translationLang = "en";
    }
 
    return {
      ref:             frRes.ref || heRes.ref || ref,
      he:              cleanHebrew(heRes.text),
      translation,
      translationLang,
      book,
      chapter,
      verse:           heRes.verse || verseHint,
    };
  }
 
  async function fetchVersion(ref, version) {
    const url =
      "https://www.sefaria.org/api/v3/texts/" +
      encodeURIComponent(ref) +
      "?version=" + encodeURIComponent(version) +
      "&fill_in_missing_segments=0";
 
    try {
      const res  = await fetch(url);
      if (!res.ok) return { text: "" };
      const data = await res.json();
 
      const versions = data.versions || [];
      if (!versions.length) return { text: "", ref: data.ref };
 
      let raw = versions[0].text;
      if (Array.isArray(raw)) raw = raw.join(" ");
      raw = stripHtml(raw || "");
 
      let verse = null;
      if (data.ref) {
        const m = data.ref.match(/:(\d+)$/);
        if (m) verse = parseInt(m[1], 10);
      }
 
      return { text: raw, ref: data.ref, verse };
    } catch {
      return { text: "" };
    }
  }
 
  // ─── Rendu DOM ────────────────────────────────────────────────────────────
 
  function el(id) { return document.getElementById(id); }
 
  function setLoading() {
    el("tdj-date").textContent        = "Chargement\u2026";
    el("tdj-ref").textContent         = "";
    el("tdj-he").textContent          = "";
    el("tdj-translation").textContent = "";
    el("tdj-tr-label").style.display  = "none";
    el("tdj-error").style.display     = "none";
    el("tdj-content").classList.add("tdj-loading");
  }
 
  function setError(msg) {
    el("tdj-error").textContent   = msg;
    el("tdj-error").style.display = "block";
    el("tdj-content").classList.remove("tdj-loading");
    el("tdj-date").textContent    = "";
  }
 
  function renderVerse(data, date) {
    const bookFr   = BOOK_NAMES_FR[data.book] || data.book;
    const langLabel = data.translationLang === "fr"
      ? "Traduction\u00A0— André Chouraqui"
      : "Traduction\u00A0— JPS 2006 (anglais)";
 
    el("tdj-date").textContent        = formatDateFr(date);
    el("tdj-ref").textContent         =
      bookFr + "\u00A0\u2014 chapitre\u00A0" + data.chapter + ", verset\u00A0" + data.verse;
    el("tdj-he").textContent          = data.he;
    el("tdj-translation").textContent = data.translation || "Traduction indisponible.";
    el("tdj-tr-label").textContent    = langLabel;
    el("tdj-tr-label").style.display  = "block";
    el("tdj-content").classList.remove("tdj-loading");
    el("tdj-error").style.display     = "none";
  }
 
  // ─── Navigation ───────────────────────────────────────────────────────────
 
  let currentDate = localMidnight(new Date());
  const today     = localMidnight(new Date());
 
  async function loadVerse(date) {
    setLoading();
    updateNavButtons(date);
    const seed   = dateToSeed(date);
    const picked = pickVerse(seed);
    try {
      const data = await fetchVerse(picked.book, picked.chapter, picked.verse);
      renderVerse(data, date);
    } catch (e) {
      setError("Impossible de charger le verset. Vérifiez votre connexion et rechargez la page.");
      console.error("Sefaria error:", e);
    }
  }
 
  function updateNavButtons(date) {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    el("tdj-next").disabled  = localMidnight(next) > today;
    el("tdj-today").disabled = date.getTime() === today.getTime();
  }
 
  function navigate(deltaDays) {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + deltaDays);
    const m = localMidnight(next);
    if (m > today) return;
    currentDate = m;
    loadVerse(currentDate);
  }
 
  // ─── Init ─────────────────────────────────────────────────────────────────
 
  document.addEventListener("DOMContentLoaded", function () {
    el("tdj-prev").addEventListener("click",  () => navigate(-1));
    el("tdj-next").addEventListener("click",  () => navigate(+1));
    el("tdj-today").addEventListener("click", () => {
      currentDate = localMidnight(new Date());
      loadVerse(currentDate);
    });
    loadVerse(currentDate);
  });
 
})();
 
