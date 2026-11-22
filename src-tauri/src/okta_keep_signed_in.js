// Injected into Muster's sign-in window and in-app browser window.
//
// Okta's sign-in session is a browser-session cookie unless "Keep me signed in" is ticked,
// so it vanished when Muster closed, and every Monash service opened later in the in-app
// window asked for the Monash email, password and MFA again. Pre-tick that box so the
// Okta session survives restarts (up to Monash's own Okta session limits) and Monash
// sites can sign in silently.
//
// Only on Okta hosts, only the "Keep me signed in" checkbox, and each checkbox is touched
// at most once: if the student unticks it, it stays unticked.
(function () {
  try {
    if (!/(^|\.)okta\.com$/i.test(location.hostname)) return;
    var touched = typeof WeakSet === "function" ? new WeakSet() : null;
    var tick = function () {
      var boxes = document.querySelectorAll('input[type="checkbox"][name="rememberMe"], input[type="checkbox"][name="remember"]');
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        if (!touched || touched.has(box)) continue;
        touched.add(box);
        // Click (not .checked = true) so the sign-in widget's own state follows.
        if (!box.checked && !box.disabled) box.click();
      }
    };
    var start = function () {
      tick();
      new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } catch (_) {
    /* never break the sign-in page */
  }
})();
