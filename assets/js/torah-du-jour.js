(function () {
  "use strict";

  const el = (id) => document.getElementById(id);

  async function loadTorah() {
    const res = await fetch("/fr_apee.json");

    if (!res.ok) {
      throw new Error("JSON introuvable (404) → vérifie emplacement du fichier");
    }

    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Contenu reçu :", text);
      throw new Error("JSON invalide (tu reçois du HTML au lieu du JSON)");
    }
  }

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
      `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}`
    );
  }

  function localMidnight(d) {
    const x = new Date(d);
    x.setHours(0,0,0,0);
    return x;
  }

  function formatDateFr(date) {
    return date.toLocaleDateString("fr-FR", {
      weekday:"long", year:"numeric", month:"long", day:"numeric"
    });
  }

  function pick(seed) {
    const rand = seededRng(seed);

    const books = ["1","2","3","4","5"];
    const book = books[Math.floor(rand() * books.length)];

    const chapter = 1 + Math.floor(rand() * 40);
    const verseRatio = rand();

    return { book, chapter, verseRatio };
  }

  async function getVerse(data, bookId, chapter, ratio) {
    const book = Object.values(data)[bookId - 1];
    const chap = book?.[chapter];

    if (!chap) throw new Error("Chapitre introuvable");

    const verses = Object.entries(chap).map(([v, text]) => ({
      verse: Number(v),
      text
    }));

    const idx = Math.min(Math.floor(ratio * verses.length), verses.length - 1);

    return verses[idx];
  }

  async function render(date) {
    el("tdj-ref").textContent = "Chargement...";

    try {
      const data = await loadTorah();

      const { book, chapter, verseRatio } = pick(dateToSeed(date));

      const v = await getVerse(data, book, chapter, verseRatio);

      el("tdj-ref").textContent = `Verset ${v.verse}`;
      el("tdj-translation").textContent = v.text;

      el("tdj-date").textContent = formatDateFr(date);

    } catch (e) {
      console.error(e);
      el("tdj-ref").textContent = "Erreur : fichier JSON introuvable ou mal placé";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const today = localMidnight(new Date());
    render(today);
  });

})();
