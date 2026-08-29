/* =========================================================================
   Phone Box marketing site — vanilla JS, file:// friendly, no bundler.
   Handles: reveal-on-scroll, the FAQ accordion, a live countdown on the
   device mockup, the hero device's boot-in timeline, the override-demo
   tick feedback, and the waitlist form (persists to Firestore via a
   dynamic import() of the Firebase SDK, on submit only -- see the form's
   own comment block below). GSAP (CDN <script> tag, see index.html) is an optional
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

  /* ---------- Waitlist form ----------
     Writes each signup to Firestore's top-level `waitlist` collection (see
     app/firestore.rules' `match /waitlist/{docId}` block for the write
     contract this must satisfy -- create-only, exact field allow-list,
     server-pinned createdAt, no reads at all). The doc ID is derived from
     the email rather than random, so that create-only rule doubles as
     server-side dedupe -- see waitlistDocId below. The Firebase SDK is fetched
     with a dynamic import() from inside the submit handler, not a top-level
     <script type="module">, so this marketing page never pays for Firebase
     on first load just because the form exists below the fold -- the
     network request only fires once a visitor actually submits.
     Firebase-init/import work is cached after the first attempt so a retry
     following a failed write doesn't re-fetch/re-init the SDK. */
  var form = document.getElementById("waitlistForm");
  var msg = document.getElementById("formMsg");
  var thanks = document.getElementById("waitlistThanks");
  var submitBtn = form && form.querySelector('button[type="submit"]');
  if (form) {
    var submitLabel = submitBtn ? submitBtn.textContent : "";
    var waitlistDbPromise = null;
    function getWaitlistDb() {
      if (!waitlistDbPromise) {
        waitlistDbPromise = Promise.all([
          import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"),
          import("./firebaseConfig.js"),
          import("./appCheck.js"),
        ]).then(function (mods) {
          var appMod = mods[0];
          var fsMod = mods[1];
          var cfgMod = mods[2];
          var appCheckMod = mods[3];
          // Config comes from Firebase Hosting now (see firebaseConfig.js), so
          // this step is a fetch rather than a synchronous check.
          return cfgMod.loadFirebaseConfig().then(function (firebaseConfig) {
            var app = appMod.initializeApp(firebaseConfig);
            // Must run before this promise resolves to a usable db -- every
            // caller below (the submit handler's setDoc/addDoc) awaits this
            // whole promise first, so nothing touches Firestore before App
            // Check has had a chance to attach. See appCheck.js's header --
            // no-ops safely today (site key not registered yet).
            return appCheckMod.initAppCheck(app).then(function () {
              return { fs: fsMod, db: fsMod.getFirestore(app) };
            });
          });
        }).catch(function (err) {
          // Don't leave a rejected promise cached -- a transient failure
          // here (offline on first submit, CDN hiccup) shouldn't permanently
          // block every later retry this page session.
          waitlistDbPromise = null;
          throw err;
        });
      }
      return waitlistDbPromise;
    }

    /* Deterministic doc ID: SHA-256 of the normalized email, hex-encoded.
       addDoc's random ID let the same address be submitted unlimited times --
       every call minted a fresh doc, so the only thing between the public
       `waitlist` create rule and unbounded duplicate writes was the
       disabled-button guard in the submit handler, which is client-side and
       trivially bypassed (addDoc talks straight to a public Firestore
       endpoint). Keying the doc on the email instead makes a repeat signup a
       write to an ALREADY-EXISTING doc, which Firestore evaluates as `update`
       -- and app/firestore.rules denies update on this collection
       unconditionally. So the dedupe is enforced server-side, by the rule
       that is already there; no rules change is needed.
       Hashed rather than using the raw address as the ID: a doc ID is not a
       secret (it surfaces in network traces, error messages, and any future
       admin export path), and a raw email can contain '/', which is illegal
       in a Firestore document ID. */
    function waitlistDocId(email) {
      var bytes = new TextEncoder().encode(email);
      return crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
        var out = new Uint8Array(buf);
        var hex = "";
        for (var i = 0; i < out.length; i++) {
          hex += out[i].toString(16).padStart(2, "0");
        }
        return hex;
      });
    }

    function showThanksState() {
      if (thanks) {
        var showThanks = function () {
          form.setAttribute("hidden", "");
          thanks.removeAttribute("hidden");
          void thanks.offsetHeight;   // flush the hidden -> laid-out start state so .is-in transitions
          thanks.classList.add("is-in");
          thanks.setAttribute("tabindex", "-1");
          thanks.focus();
        };
        if (reduceMotion) {
          showThanks();
        } else {
          form.classList.add("is-leaving");
          window.setTimeout(showThanks, 220);
        }
      } else if (msg) {
        msg.textContent = "You're on the list. We'll be in touch when Phone Box is ready.";
        msg.className = "form-msg is-ok";
        form.reset();
      }
    }

    function setPending(isPending) {
      if (!submitBtn) { return; }
      submitBtn.disabled = isPending;
      submitBtn.textContent = isPending ? "Joining…" : submitLabel;
    }

    // Firestore's SDK can retry a stuck connection (offline, an ad-blocker
    // or corporate proxy filtering firestore.googleapis.com) silently
    // instead of rejecting -- confirmed live: with the write request
    // blocked, the SDK just keeps retrying its channel forever and the
    // setDoc promise never settles, leaving the button on "Joining…"
    // permanently with no way for the visitor to retry. dashboard.js's
    // loadDashboard hit the exact same failure mode first (see its
    // LOAD_TIMEOUT_MS/withTimeout); this mirrors that fix so a stall here
    // surfaces the same actionable error instead of hanging indefinitely.
    var SUBMIT_TIMEOUT_MS = 15000;
    function withTimeout(promise, ms) {
      return Promise.race([
        promise,
        new Promise(function (_, reject) {
          window.setTimeout(function () {
            reject(Object.assign(new Error("Waitlist signup timed out"), { code: "timeout" }));
          }, ms);
        }),
      ]);
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("email");
      var value = (input && input.value ? input.value : "").trim().toLowerCase();
      var valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
      if (!valid) {
        if (msg) {
          msg.textContent = "Please enter a valid email address.";
          msg.className = "form-msg is-err";
        }
        if (input) { input.focus(); }
        return;
      }

      // Guard against a double-tap firing two writes while the first is
      // still in flight.
      if (submitBtn && submitBtn.disabled) { return; }
      setPending(true);
      if (msg) {
        msg.textContent = "";
        msg.className = "form-msg";
      }

      withTimeout(getWaitlistDb().then(function (ctx) {
        var payload = {
          email: value,
          createdAt: ctx.fs.serverTimestamp(),
          source: "website",
        };
        // crypto.subtle is only exposed in a secure context. Production is
        // HTTPS (Firebase Hosting), so the deduped path is the one that
        // actually runs; this fallback just keeps the form working if the
        // page is ever opened over plain http, at the cost of that one
        // session writing a random-id doc the way it always used to.
        if (!(window.crypto && window.crypto.subtle)) {
          return ctx.fs.addDoc(ctx.fs.collection(ctx.db, "waitlist"), payload);
        }
        return waitlistDocId(value).then(function (id) {
          return ctx.fs.setDoc(ctx.fs.doc(ctx.db, "waitlist", id), payload);
        });
      }), SUBMIT_TIMEOUT_MS).then(function () {
        // Leave the button disabled -- the form is about to be hidden
        // entirely by the cross-fade into the thank-you state.
        showThanksState();
      }).catch(function (err) {
        // A repeat signup lands here: the doc already exists, so the write is
        // an `update`, which the rules deny. That is the dedupe working, not a
        // failure -- show the same thank-you a first-time signup gets. Saying
        // "you're already on the list" instead would turn this form into an
        // oracle for testing whether any given address had signed up.
        if (err && err.code === "permission-denied") {
          showThanksState();
          return;
        }
        if (window.console && console.error) { console.error("Waitlist signup failed:", err); }
        setPending(false);
        if (msg) {
          msg.textContent = "Something went wrong — please try again in a moment.";
          msg.className = "form-msg is-err";
        }
      });
    });
  }
})();
