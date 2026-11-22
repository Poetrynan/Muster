// Injected into the in-app browser window (open_in_app_webview).
//
// Some Monash services open on a chooser page that only starts the sign-in: WES shows
// "Current students / Past students" buttons whose form POSTs to /wes/login/, which then
// redirects to Monash Okta. The window already carries the Okta session, so pressing the
// button is the only thing standing between the student and the page. Press it once.
//
// Scoped tightly: only my.monash.edu.au/wes*, only the chooser form (never a form with a
// username or password field), and at most once per window so it can never loop.
// The Monash Malaysia helpdesk is a single-page app whose sign-in page offers
// "Sign-in with Monash OKTA" next to an email login for non-Monash users. Muster users are
// Monash users: press the Okta button once when that page appears.
(function () {
  try {
    if (location.hostname !== "helpdesk.monash.edu.my") return;
    var KEY = "muster:helpdesk-okta";
    var press = function () {
      if (!/\/auth\/sign-in/.test(location.pathname) || sessionStorage.getItem(KEY)) return;
      var buttons = document.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) {
        if (/sign-?in with monash okta/i.test(buttons[i].textContent || "") && !buttons[i].disabled) {
          sessionStorage.setItem(KEY, "1");
          buttons[i].click();
          return;
        }
      }
    };
    var start = function () {
      press();
      // Client-side routing: the sign-in page can appear without a page load.
      new MutationObserver(press).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  } catch (_) {
    /* never break the page */
  }
})();

(function () {
  try {
    if (location.hostname !== "my.monash.edu.au" || !location.pathname.startsWith("/wes")) return;
    var KEY = "muster:wes-continue";
    var run = function () {
      var form = document.forms.namedItem("login");
      if (!form || !form.querySelector('input[name="login_to_wes"]')) return;
      if (form.querySelector('input[name="username"], input[type="password"]')) return;
      if (sessionStorage.getItem(KEY)) return;
      var buttons = form.querySelectorAll('input[type="submit"][name="student_type"]');
      for (var i = 0; i < buttons.length; i++) {
        if (/current/i.test(buttons[i].value)) {
          sessionStorage.setItem(KEY, "1");
          buttons[i].click();
          return;
        }
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
      run();
    }
  } catch (_) {
    /* never break the page */
  }
})();
