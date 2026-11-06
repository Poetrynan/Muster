(() => {
  if (window.top !== window || location.origin !== "https://home.student.monash") return;
  let delivered = false;
  const endpoint = value => {
    try {
      const u = new URL(value, location.href);
      return u.origin === location.origin && u.pathname === "/api/student/userEvents";
    } catch { return false; }
  };
  const deliver = (status, body, etag) => {
    if (delivered && window.__musterPortalResult?.status === 200) return;
    delivered = true;
    // Forward exams only. Never transfer tokens, grades, identity or unrelated events.
    const result = { status, errorFlags: { exams: body?.errorFlags?.exams },
      events: Array.isArray(body?.events) ? body.events.filter(e => e.eventType === "exam") : null };
    // Read via Tauri's native eval callback; never put credentials or data in URLs.
    if (etag) result.etag = etag;
    window.__musterPortalResult = result;
  };
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const input = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (endpoint(input)) response.clone().json().then(body => deliver(response.status, body, response.headers?.get("ETag"))).catch(() => deliver(response.status, null));
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (endpoint(String(url))) this.addEventListener("load", () => {
      try { deliver(this.status, this.responseType === "json" ? this.response : JSON.parse(this.responseText)); }
      catch { deliver(this.status, null); }
    }, { once: true });
    return originalOpen.call(this, method, url, ...rest);
  };
})();
