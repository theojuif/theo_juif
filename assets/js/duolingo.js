document.addEventListener("DOMContentLoaded", () => {
  const startDate = new Date("2025-03-16");
  const today = new Date();

  startDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffDays =
    Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;

  document.getElementById("duolingo-count").textContent = diffDays;
});
