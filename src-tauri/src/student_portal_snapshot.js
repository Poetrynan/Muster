(() => {
  if (location.origin !== "https://home.student.monash") {
    // Only real sign-in / MFA UI counts; Moodle pages and auto-posting SAML hops do not.
    const interactive = 'input[type="password"], input[name="identifier"], input[name="username"], form[data-se="o-form"], [data-se="authenticator-button"]';
    return { stage: "sso", needsInteraction: document.readyState === "complete" && location.hostname !== "learning.monash.edu" && !!document.querySelector(interactive) };
  }
  let session;
  for (const store of [sessionStorage, localStorage]) {
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (!name?.startsWith("firebase:authUser:")) continue;
      try {
        const user = JSON.parse(store.getItem(name));
        if (user?.stsTokenManager?.refreshToken && user.email && user.uid && user.apiKey) {
          session = { apiKey: user.apiKey, refreshToken: user.stsTokenManager.refreshToken, uid: user.uid, email: user.email };
        }
      } catch { /* Skip malformed unrelated records. */ }
    }
  }
  return { stage: "portal", session, result: window.__musterPortalResult };
})();
