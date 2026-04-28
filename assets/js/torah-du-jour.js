(function () {
  "use strict";

  // ─── CONFIG ─────────────────────────────────────────

  const TORAH_BOOKS = [
    { name: "Genesis",     id: "1", chapters: 50 },
    { name: "Exodus",      id: "2", chapters: 40 },
    { name: "Leviticus",   id: "3", chapters: 27 },
    { name: "Numbers",     id: "4", chapters: 36 },
    { name: "Deuteronomy", id: "5", chapters: 34 },
  ];

  const BOOK_NAMES_FR = {
    Genesis:     "Bereshit · Genèse",
    Exodus:      "Shemot · Exode",
    Leviticus:   "Vayikra · Lévitique",
    Numbers:     "Bamidbar · Nombres",
    Deuteronomy: "Devarim · Deutéronome",
  };

  // ─── DATA CACHE ─────────────────────────────────────

  let BIBLE_DATA = null;

  async function loadBible() {
    if (BIBLE_DATA) return BIBLE_DATA;

    const url = "https://cdn.jsdelivr.net/gh/thiagobodruk/bible@master/json/fr_lsg.json";
    const res = await fetch(url);
    BIBLE_DATA = await res.json();

    return BIBLE_DATA;
  }

  // ─── RNG ────────────────────────────────────────────

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
    return parseInt(
      `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}`,
      10
    );
  }

  // ─── UTILS DATE ─────────────────────────────────────

  function localMidnight(date) {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    return d;
  }

  function formatDateFr(date) {
    return date.toLocaleDateString("fr-FR", {
      weekday:"long", year:"numeric", month:"long", day:"numeric"
    });
  }

  // ─── HEBREU ─────────────────────────────────────────

  function cleanHebrew(raw) {
    if (!raw) return "";
    if (Array.isArray(raw)) raw = raw.join(" ");
    return raw.replace(/<[^>]+>/g,"").trim();
  }

  async function fetchHebrew(book, chapter, verse) {
    try {
      const url = `https://www.sefaria.org/api/texts/${book}.${chapter}.${verse}?context=0`;
      const res = await fetch(url);
      const data = await res.json();
      return cleanHebrew(data.he);
    } catch {
      return "";
    }
  }

  // ─── SELECTION ──────────────────────────────────────

  function pickTarget(seed) {
    const rand = seededRng(seed);

    const total = TORAH_BOOKS.reduce((a,b)=>a+b.chapters,0);
    let r = rand() * total;

    let book = TORAH_BOOKS[0];
    for (const b of TORAH_BOOKS) {
      r -= b.chapters;
      if (r <= 0) { book = b; break; }
    }

    const chapter = 1 + Math.floor(rand()*book.chapters);
    const verseRatio = rand();

    return { book, chapter, verseRatio };
  }

  // ─── LSG (LOCAL JSON) ───────────────────────────────

  async function fetchChapterLSG(bookId, chapter) {
    const data = await loadBible();

    const book = data[bookId];
    if (!book) throw new Error("Livre introuvable");

    const chap = book[chapter];
    if (!chap) throw new Error("Chapitre introuvable");

    return Object.entries(chap).map(([v, text]) => ({
      verse: parseInt(v,10),
      text
    }));
  }

  async function fetchVerse(book, chapter, ratio) {
    const verses = await fetchChapterLSG(book.id, chapter);

    const idx = Math.min(Math.floor(ratio * verses.length), verses.length - 1);
    const v = verses[idx];

    const he = await fetchHebrew(book.name, chapter, v.verse);

    return {
      book: book.name,
      chapter,
      verse: v.verse,
      fr: v.text,
      he
    };
  }

  // ─── DOM ───────────────────────────────────────────

  const el = id => document.getElementById(id);

  function setLoading(date) {
    el("tdj-date").textContent = formatDateFr(date);
    el("tdj-ref").textContent = "Chargement…";
    el("tdj-he").textContent = "";
    el("tdj-translation").textContent = "";
  }

  function setError(msg) {
    el("tdj-ref").textContent = msg;
  }

  function render(v, date) {
    el("tdj-date").textContent = formatDateFr(date);
    el("tdj-ref").textContent =
      `${BOOK_NAMES_FR[v.book]} — chapitre ${v.chapter}, verset ${v.verse}`;
    el("tdj-he").textContent = v.he;
    el("tdj-translation").textContent = v.fr;
  }

  // ─── NAV ───────────────────────────────────────────

  let currentDate, today;

  function updateNav(date) {
    const next = new Date(date);
    next.setDate(next.getDate()+1);

    el("tdj-next").disabled = localMidnight(next) > today;
    el("tdj-today").disabled = date.getTime() === today.getTime();
  }

  async function load(date) {
    setLoading(date);
    updateNav(date);

    const { book, chapter, verseRatio } = pickTarget(dateToSeed(date));

    try {
      const v = await fetchVerse(book, chapter, verseRatio);
      render(v, date);
    } catch (e) {
      console.error(e);
      setError("Erreur de chargement");
    }
  }

  function navigate(delta) {
    const d = new Date(currentDate);
    d.setDate(d.getDate()+delta);
    if (d > today) return;
    currentDate = localMidnight(d);
    load(currentDate);
  }

  // ─── INIT ──────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", () => {
    today = localMidnight(new Date());
    currentDate = today;

    el("tdj-prev").onclick = () => navigate(-1);
    el("tdj-next").onclick = () => navigate(1);
    el("tdj-today").onclick = () => {
      currentDate = today;
      load(today);
    };

    load(today);
  });

})();
