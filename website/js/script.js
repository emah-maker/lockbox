/* =========================================================================
   Phone Box documentation page — vanilla JS, file:// friendly, no bundler.
   Handles: the table of contents (collapsed by default on narrow screens,
   current section highlighted while scrolling) and the override-demo tick
   feedback. GSAP (CDN <script> tag, see index.html) is an optional
   progressive-enhancement layer for the override ticks -- every
   `window.gsap` check has a plain-CSS fallback if the CDN script fails to
   load. Everything degrades gracefully and respects prefers-reduced-motion.
   ========================================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Table of contents ---------- */
  var toc = document.getElementById("toc");
  if (toc) {
    // The markup ships `open` so the TOC is usable without JS; on a phone
    // it would push the content a full screen down, so start it closed there
    // and close it again after a jump.
    var narrow = window.matchMedia("(max-width: 900px)");
    if (narrow.matches) { toc.removeAttribute("open"); }
    // On desktop the TOC is a sidebar with no visible toggle, so a phone-width
    // load that later widens (rotation, window resize) must not leave it shut.
    var onNarrowChange = function (e) { if (!e.matches) { toc.setAttribute("open", ""); } };
    if (narrow.addEventListener) { narrow.addEventListener("change", onNarrowChange); }
    else if (narrow.addListener) { narrow.addListener(onNarrowChange); }
    toc.addEventListener("click", function (e) {
      if (narrow.matches && e.target.closest("a")) { toc.removeAttribute("open"); }
    });

    // Scrollspy: mark the link for the last heading scrolled past the top.
    var links = Array.prototype.slice.call(toc.querySelectorAll("a[href^='#']"));
    var targets = links
      .map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var activeLink = null;
    var spyTicking = false;
    var updateSpy = function () {
      spyTicking = false;
      var line = 120;   // just under the sticky nav
      var current = null;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].getBoundingClientRect().top <= line) { current = links[i]; }
      }
      if (!current) { current = links[0]; }
      if (current !== activeLink) {
        if (activeLink) { activeLink.classList.remove("is-active"); activeLink.removeAttribute("aria-current"); }
        current.classList.add("is-active");
        current.setAttribute("aria-current", "location");
        activeLink = current;
      }
    };
    if (links.length) {
      updateSpy();
      window.addEventListener("scroll", function () {
        if (!spyTicking) { window.requestAnimationFrame(updateSpy); spyTicking = true; }
      }, { passive: true });
    }
  }

  /* ---------- Override press-demo: proves the mechanism, not just names it ---------- */
  var ovrBtn = document.getElementById("overrideBtn");
  var ovrTicks = document.getElementById("overrideTicks");
  var ovrStatus = document.getElementById("overrideStatus");
  if (ovrBtn && ovrTicks && ovrStatus) {
    var OVR_TOTAL = 25;
    var ovrCount = 0;
    var ovrHasGsap = !reduceMotion && !!window.gsap;
    for (var i = 0; i < OVR_TOTAL; i++) {
      var t = document.createElement("span");
      t.className = "override-demo__tick";
      ovrTicks.appendChild(t);
    }
    var ticks = ovrTicks.querySelectorAll(".override-demo__tick");
    function ovrPaint() {
      ticks.forEach(function (t, i) { t.classList.toggle("is-hit", i < ovrCount); });
      if (ovrCount >= OVR_TOTAL) {
        ovrStatus.textContent = "Released";
        ovrStatus.classList.add("is-released");
        ovrBtn.disabled = true;
        // Settle-in pop on the status text -- feedback that the mechanism
        // actually fired, not just a label swap.
        if (ovrHasGsap) {
          gsap.fromTo(ovrStatus, { scale: 1.15 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
        }
      } else {
        ovrStatus.textContent = ovrCount + " / " + OVR_TOTAL;
      }
    }
    ovrBtn.addEventListener("click", function () {
      if (ovrCount >= OVR_TOTAL) { return; }
      ovrCount += 1;
      ovrPaint();
      // Pop only the tick that was just hit -- proof this exact press
      // registered, not a replay across every earlier tick.
      if (ovrHasGsap) {
        gsap.fromTo(ticks[ovrCount - 1], { scale: 1.5 }, { scale: 1, duration: 0.28, ease: "back.out(3)" });
      }
      if (ovrCount >= OVR_TOTAL) {
        setTimeout(function () {
          ovrCount = 0;
          ovrBtn.disabled = false;
          ovrStatus.classList.remove("is-released");
          ovrPaint();
        }, 2200);
      }
    });
  }

})();
