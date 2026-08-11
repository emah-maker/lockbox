/* =========================================================================
   nav.js -- shared mobile-nav toggle for index.html and dashboard.html.
   Plain vanilla JS, no dependency, no bundler -- loaded via a <script> tag
   on both pages ahead of the page-specific script (script.js / dashboard.js)
   so the toggle works the same way regardless of which page it's on. CSS
   (styles.css .nav__menu, reusing the .acc__panel grid-rows technique) does
   the animating; this file only flips ARIA state and a class.
   ========================================================================= */
(function () {
  "use strict";

  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("navMenu");
  if (!toggle || !menu) { return; }

  function setOpen(open) {
    toggle.setAttribute("aria-expanded", String(open));
    menu.classList.toggle("is-open", open);
  }

  toggle.addEventListener("click", function () {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  // Close on any link/button tap inside the menu -- it's a same-page anchor
  // nav or a sign-out action, either way the menu shouldn't linger open.
  menu.addEventListener("click", function (e) {
    if (e.target.closest("a, button")) { setOpen(false); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", function (e) {
    if (toggle.getAttribute("aria-expanded") === "true" &&
        !menu.contains(e.target) && e.target !== toggle) {
      setOpen(false);
    }
  }, true);

  // If the viewport grows past the mobile breakpoint while the menu is open,
  // drop the open state so it can't reappear stuck-open on shrink-back.
  var mq = window.matchMedia("(min-width: 721px)");
  var onBreakpointChange = function (e) { if (e.matches) { setOpen(false); } };
  if (mq.addEventListener) { mq.addEventListener("change", onBreakpointChange); }
  else if (mq.addListener) { mq.addListener(onBreakpointChange); }
})();
