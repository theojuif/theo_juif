document.addEventListener("DOMContentLoaded", function() {

    const list = document.getElementById("donor-list");
    const countSpan = document.getElementById("donor-count");

    if (!list || !countSpan) return;

    const numberOfDonors = list.querySelectorAll("li").length;

    countSpan.textContent = numberOfDonors + (numberOfDonors > 1 ? " donateurs" : " donateur");

});
