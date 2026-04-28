(function () {
  "use strict";

  // ─── CONFIG ─────────────────────────────────────────

  const TORAH_BOOKS = [
    { name: "Genesis", id: "1", chapters: 50 },
    { name: "Exodus", id: "2", chapters: 40 },
    { name: "Leviticus", id: "3", chapters: 27 },
    { name: "Numbers", id: "4", chapters: 36 },
    { name: "Deuteronomy", id: "5", chapters: 34 },
  ];

  const BOOK_NAMES_FR = {
    Genesis: "Bereshit · Genèse",
    Exodus: "Shemot · Exode",
    Leviticus: "Vayikra · Lévitique",
    Numbers: "Bamidbar · Nombres",
    Deuteronomy: "Devarim · Deutéronome",
  };

  let TORAH = null;

  async function loadTorah() {
    if (TORAH) return TORAH;

    const res = await fetch("/torah.json");
    TORAH = await res.json();
    return TORAH;
  }

  // ─── RNG ───────────────────────────────────────────

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

  async function fetchHebrew(book, chapter, verse) {
    try {
      const url = `https://www.sefaria.org/api/texts/${book}.${chapter}.${verse}?context=0`;
      const res = await fetch(url);
      const data = await res.json();
      return (data.he || "").replace(/<[^>]+>/g,"");
    } catch {
      return "";
    }
  }

  // ─── FETCH LOCAL ───────────────────────────────────

  async function fetchChapter(bookId, chapter) {
    const data = await loadTorah();

    const book = data[bookId];
    if (!book) throw new Error("Livre introuvable");

    const chap = book[chapter];
    if (!chap) throw new Error("Chapitre introuvable");

    return Object.entries(chap).map(([v, text]) => ({
      verse: parseInt(v,10),
      text
    }));
  }

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

  async function fetchVerse(book, chapter, ratio) {
    const verses = await fetchChapter(book.id, chapter);

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

  function render(v, date) {
    el("tdj-date").textContent = formatDateFr(date);
    el("tdj-ref").textContent =
      `${BOOK_NAMES_FR[v.book]} — chapitre ${v.chapter}, verset ${v.verse}`;
    el("tdj-he").textContent = v.he;
    el("tdj-translation").textContent = v.fr;
  }

  let currentDate, today;

  async function load(date) {
    const { book, chapter, verseRatio } = pickTarget(dateToSeed(date));
    try {
      render(await fetchVerse(book, chapter, verseRatio), date);
    } catch (e) {
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    today = localMidnight(new Date());
    currentDate = today;
    load(today);
  });

})();
