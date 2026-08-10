/* =========================================================================
   Phone Box marketing site — vanilla JS, no dependencies, file:// friendly.
   Handles: reveal-on-scroll, the FAQ accordion, a live countdown on the
   device mockup, and the waitlist form (client-side only — this is a draft
   with no backend). All features degrade gracefully and respect
   prefers-reduced-motion.
   ========================================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Reveal-on-scroll ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ---------- FAQ accordion ---------- */
  var accButtons = document.querySelectorAll(".acc__btn");
  accButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      var panelId = btn.getAttribute("aria-controls");
      var panel = panelId && document.getElementById(panelId);
      btn.setAttribute("aria-expanded", String(!expanded));
      if (panel) {
        if (expanded) { panel.setAttribute("hidden", ""); }
        else { panel.removeAttribute("hidden"); }
      }
    });
  });

  /* ---------- Live countdown on the device mockup ---------- */
  var timeEl = document.getElementById("mockTime");
  var barEl = document.getElementById("mockBar");
  var lockEl = document.getElementById("scrLockLabel");
  var TOTAL = 25 * 60;              // demo session length: 25:00
  var remaining = 24 * 60 + 59;     // start where the static markup shows (0:24:59)

  function hms(secs) {
    secs = Math.max(0, secs | 0);
    var h = (secs / 3600) | 0;
    var m = ((secs % 3600) / 60) | 0;
    var s = secs % 60;
    return h + ":" + (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }

  // Mirrors Box-code/lib/lock_ui.py update_clock_view(): while state ==
  // "running" the digital time and the LOCKED label are fixed coral-red
  // (the firmware's own locked-state color), full stop -- there is no
  // green/amber/red urgency gradient on the main clock, only on the
  // separate battery and override-timeout bars.
  function paint() {
    if (timeEl) { timeEl.textContent = hms(remaining); }
    if (barEl) {
      barEl.style.setProperty("--fill", remaining / TOTAL);
    }
  }

  paint();

  if (!reduceMotion && timeEl) {
    setInterval(function () {
      remaining -= 1;
      if (remaining < 0) {           // loop the demo
        remaining = TOTAL;
        if (lockEl) { lockEl.textContent = "LOCKED"; }
      }
      paint();
    }, 1000);
  }

  /* ---------- Override press-demo: proves the mechanism, not just names it ---------- */
  var ovrBtn = document.getElementById("overrideBtn");
  var ovrTicks = document.getElementById("overrideTicks");
  var ovrStatus = document.getElementById("overrideStatus");
  if (ovrBtn && ovrTicks && ovrStatus) {
    var OVR_TOTAL = 25;
    var ovrCount = 0;
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
      } else {
        ovrStatus.textContent = ovrCount + " / " + OVR_TOTAL;
      }
    }
    ovrBtn.addEventListener("click", function () {
      if (ovrCount >= OVR_TOTAL) { return; }
      ovrCount += 1;
      ovrPaint();
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

  /* ---------- Waitlist form (client-side only, no backend) ---------- */
  var form = document.getElementById("waitlistForm");
  var msg = document.getElementById("formMsg");
  var thanks = document.getElementById("waitlistThanks");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("email");
      var value = (input && input.value ? input.value : "").trim();
      var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      if (!valid) {
        if (msg) {
          msg.textContent = "Please enter a valid email address.";
          msg.className = "form-msg is-err";
        }
        if (input) { input.focus(); }
        return;
      }
      // Success — swap the form for the thank-you state.
      if (thanks) {
        form.setAttribute("hidden", "");
        thanks.removeAttribute("hidden");
        thanks.setAttribute("tabindex", "-1");
        thanks.focus();
      } else if (msg) {
        msg.textContent = "You're on the list. We'll be in touch when Phone Box is ready.";
        msg.className = "form-msg is-ok";
        form.reset();
      }
    });
  }
})();
