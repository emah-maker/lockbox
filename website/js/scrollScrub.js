/* =========================================================================
   Scroll-scrubbed "How it works" video -- progressive enhancement only.
   Kept out of script.js per the file's own size budget; follows the same
   idioms (IIFE, "use strict", var/function expressions, an
   IntersectionObserver pause pattern copied from the hero device-mockup
   countdown in script.js).

   Everything here is additive: the section already renders correctly with
   zero JS (the static 4-card .steps layout, see index.html + styles.css).
   This file only ever *adds* a mode class (how--scrub / how--reduced) once
   it has confirmed the video is actually usable; if anything goes wrong it
   leaves the section exactly as the static markup already has it.
   ========================================================================= */
(function () {
  "use strict";

  var track = document.getElementById("howTrack");
  var pin = document.getElementById("howPin");
  var videoWrap = document.getElementById("howVideoWrap");
  var video = document.getElementById("howVideo");
  var stepsList = document.getElementById("howSteps");

  if (!track || !pin || !videoWrap || !video || !stepsList) { return; }

  var steps = stepsList.querySelectorAll(".step");

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var METADATA_TIMEOUT = 4000; // ms to wait for loadedmetadata before giving up
  // Interpolation factor toward the scroll target. The real asset is an
  // all-keyframe encode (every one of its 88 frames is independently
  // seekable), so there is no decode-stutter risk to hide behind a heavy
  // lerp the way a normal long-GOP export would need -- 0.12 (tuned blind,
  // before any decodable file existed) read as slightly laggy/rubbery
  // against the real 3.7s clip once scrubbed by hand. 0.18 tracks the
  // scroll position noticeably tighter while still smoothing out the
  // per-event jitter of the browser's native scroll ticks.
  var LERP = 0.18;
  var EPSILON = 0.0008;    // snap-to-target threshold, avoids an endless tiny-delta loop

  /* ---------- Step highlighting ---------- */
  function setActiveStep(progress) {
    var idx = Math.floor(progress * steps.length);
    if (idx < 0) { idx = 0; }
    if (idx > steps.length - 1) { idx = steps.length - 1; }
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle("is-active", i === idx);
    }
  }

  /* ---------- Scrub engine (only ever started in scrub mode) ---------- */
  var duration = 0;
  var targetProgress = 0;
  var currentProgress = 0;
  var rafId = null;
  var scrubVisible = false;
  var scrollBound = false;

  function computeProgress() {
    var rect = track.getBoundingClientRect();
    var scrollable = track.offsetHeight - window.innerHeight;
    if (scrollable <= 0) { return 0; }
    var p = -rect.top / scrollable;
    if (p < 0) { p = 0; }
    if (p > 1) { p = 1; }
    return p;
  }

  function onScroll() {
    targetProgress = computeProgress();
  }

  function applyProgress(p) {
    if (duration > 0 && video.readyState >= 2) {
      video.currentTime = p * duration;
    }
    setActiveStep(p);
  }

  function loop() {
    rafId = null;
    if (!scrubVisible) { return; }   // section off-screen -- loop stays stopped
    var delta = targetProgress - currentProgress;
    if (Math.abs(delta) > EPSILON) {
      currentProgress += delta * LERP;
    } else {
      currentProgress = targetProgress;
    }
    applyProgress(currentProgress);
    rafId = window.requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId === null) { rafId = window.requestAnimationFrame(loop); }
  }
  function stopLoop() {
    if (rafId !== null) { window.cancelAnimationFrame(rafId); rafId = null; }
  }

  function bindScroll() {
    if (scrollBound) { return; }
    scrollBound = true;
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  function unbindScroll() {
    if (!scrollBound) { return; }
    scrollBound = false;
    window.removeEventListener("scroll", onScroll, { passive: true });
  }

  // Mirrors script.js's hero-device IntersectionObserver: the rAF loop (and
  // the scroll listener that feeds it) only run while the track is
  // actually on screen, so the page costs nothing once the user has
  // scrolled past this section.
  function watchVisibility() {
    if (!("IntersectionObserver" in window)) {
      scrubVisible = true;
      bindScroll();
      onScroll();
      startLoop();
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      var entry = entries[entries.length - 1];
      scrubVisible = entry.isIntersecting;
      if (scrubVisible) {
        bindScroll();
        onScroll();
        startLoop();
      } else {
        unbindScroll();
        stopLoop();
      }
    }, { threshold: 0 });
    io.observe(track);
  }

  /* ---------- iOS seek priming ----------
     Mobile Safari refuses to seek a video that has never been played, so
     prime it with a play() immediately followed by a pause() -- on the
     first user gesture if one arrives first, otherwise as soon as the
     browser says it can play. The play() promise rejects harmlessly if the
     browser still declines (e.g. no gesture yet); that rejection is
     expected and swallowed. */
  var primed = false;
  function primeVideo() {
    if (primed) { return; }
    primed = true;
    try {
      var p = video.play();
      if (p && typeof p.then === "function") {
        p.then(function () { video.pause(); }).catch(function () { /* no gesture yet -- fine, will retry on next trigger */ primed = false; });
      } else {
        video.pause();
      }
    } catch (e) { primed = false; }
  }
  function setupPriming() {
    video.addEventListener("canplay", primeVideo, { once: true });
    var gestures = ["touchstart", "pointerdown", "scroll"];
    for (var i = 0; i < gestures.length; i++) {
      window.addEventListener(gestures[i], primeVideo, { once: true, passive: true });
    }
  }

  /* ---------- Mode transitions ---------- */
  function enterScrubMode() {
    track.classList.add("how--scrub");
    setupPriming();
    setActiveStep(0);   // first beat highlighted immediately, before any scroll
    watchVisibility();
  }

  function enterReducedMode() {
    track.classList.add("how--reduced");
    video.controls = true;
    video.removeAttribute("aria-hidden");
    video.removeAttribute("tabindex");
  }

  var failed = false;
  function fallbackToStatic() {
    if (failed) { return; }
    failed = true;
    window.clearTimeout(metadataTimer);
    stopLoop();
    unbindScroll();
    track.classList.remove("how--scrub", "how--reduced");
  }

  /* ---------- Decide + load ---------- */
  var metadataTimer = null;

  function onMetadataReady() {
    window.clearTimeout(metadataTimer);
    if (failed) { return; }
    duration = video.duration;
    if (!duration || !isFinite(duration) || duration <= 0) {
      fallbackToStatic();
      return;
    }
    if (reduceMotion) {
      enterReducedMode();
    } else {
      enterScrubMode();
    }
  }

  video.addEventListener("error", fallbackToStatic, true);
  video.addEventListener("loadedmetadata", onMetadataReady);

  // Scrub mode is now attempted at every viewport width. The asset is
  // portrait (720x1280), which suits a phone screen at least as well as a
  // desktop one, so the old "skip entirely below 700px" cutoff (written
  // against a 16:9 asset that would have looked stretched and oversized on
  // a narrow screen) no longer has a reason to exist -- see the layout
  // rationale at the top of css/scrollScrub.css for the two responsive
  // shapes (side-by-side vs. stacked) this now renders as.

  // Gate on loadedmetadata firing within a short window; if the file 404s,
  // the browser's own `error` event usually fires first, but a stalled/
  // hanging request (or a browser that doesn't emit `error` cleanly for a
  // missing multi-<source> video) is covered by this timeout too.
  metadataTimer = window.setTimeout(fallbackToStatic, METADATA_TIMEOUT);
  video.preload = "auto";
  video.load();
})();
