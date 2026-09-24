/* =========================================================================
   Phone Box marketing site — vanilla JS, file:// friendly, no bundler.
   Handles: reveal-on-scroll, the FAQ accordion, a live countdown on the
   device mockup, the hero device's boot-in timeline, and the override-demo
   tick feedback. GSAP (CDN <script> tag, see index.html) is an optional
   progressive-enhancement layer for the two timeline/stagger moments below
   (hero boot, override ticks) -- every `window.gsap` check has a plain-CSS
   fallback already in place if the CDN script fails to load. All features
   degrade gracefully and respect prefers-reduced-motion.
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

    // Safety-reveal fallback: the <noscript> block in index.html covers the
    // no-JS case, but this covers the JS-runs-but-something-goes-wrong case
    // (an error earlier in this IIFE, a stalled/never-intersecting observer,
    // etc.) -- without it a single thrown error above would leave the whole
    // page permanently at opacity:0.
    window.setTimeout(function () {
      revealEls.forEach(function (el) { el.classList.add("in"); });
    }, 2000);
  }

  /* ---------- FAQ accordion ---------- */
  var accButtons = document.querySelectorAll(".acc__btn");
  accButtons.forEach(function (btn) {
    var panelId = btn.getAttribute("aria-controls");
    var panel = panelId && document.getElementById(panelId);
    if (panel) {
      // Hand the collapsed state over to CSS. The markup ships `hidden` so the
      // answers stay closed without JS, but display:none can't transition --
      // .acc__panel's grid-row/visibility pair takes over from here.
      if (btn.getAttribute("aria-expanded") === "true") { panel.classList.add("is-open"); }
      panel.removeAttribute("hidden");
    }
    btn.addEventListener("click", function () {
      var expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      if (panel) { panel.classList.toggle("is-open", !expanded); }
    });
  });

  /* ---------- Hero device intro: the screen "boots" ----------
     The device casing already fades/slides in via the generic .reveal class
     (below) -- this adds a second, purposeful beat on top: once the casing
     has landed, the screen's own contents stagger in like it just powered
     on, instead of appearing as part of the same flat fade. First-load-only
     tier (see the motion-and-animation skill's frequency gate), so the small
     extra delight budget is spent here rather than on a static readout. */
  if (!reduceMotion && window.gsap) {
    var scrEls = [".scr__status", ".scr__label", "#mockTime", ".scr__bar", ".scr__hint"]
      .map(function (sel) { return document.querySelector(sel); })
      .filter(Boolean);
    if (scrEls.length) {
      gsap.set(scrEls, { opacity: 0, y: 6 });
      gsap.to(scrEls, {
        opacity: 1,
        y: 0,
        duration: 0.4,
        ease: "power2.out",
        stagger: 0.07,
        delay: 0.5,   // let the casing's own .reveal transition land first
      });
    }
  }

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

  // Mirrors firmware/lib/lock_ui.py update_clock_view(): while state ==
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
    var countdownTimer = null;
    var tick = function () {
      remaining -= 1;
      if (remaining < 0) {           // loop the demo
        remaining = TOTAL;
        if (lockEl) { lockEl.textContent = "LOCKED"; }
      }
      paint();
    };
    var startCountdown = function () {
      if (countdownTimer === null) { countdownTimer = setInterval(tick, 1000); }
    };
    var stopCountdown = function () {
      if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null; }
    };

    // Only run the tick while the tab is visible AND the device mockup is
    // actually on screen -- a single 1s interval is cheap, but there's no
    // reason to keep it ticking against a backgrounded tab or a hero
    // scrolled far out of view.
    var deviceEl = document.querySelector(".hero__device");
    var deviceVisible = !deviceEl || !("IntersectionObserver" in window);
    var updateRunState = function () {
      if (document.visibilityState === "visible" && deviceVisible) {
        startCountdown();
      } else {
        stopCountdown();
      }
    };

    if (deviceEl && "IntersectionObserver" in window) {
      var deviceIo = new IntersectionObserver(function (entries) {
        deviceVisible = entries[entries.length - 1].isIntersecting;
        updateRunState();
      }, { threshold: 0 });
      deviceIo.observe(deviceEl);
    }
    document.addEventListener("visibilitychange", updateRunState);
    updateRunState();
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
