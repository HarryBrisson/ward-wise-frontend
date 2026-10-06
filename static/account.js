// Who is signed in, for static pages. The pages are built once and served to everyone, so the
// avatar menu can't be rendered on the server; instead ask /api/me (same origin — the session
// cookie rides along, and CloudFront never caches it). Signed-out readers get a 401 and nothing
// changes: there is deliberately no "Log in" link, the login page appears when a gated page needs it.
(function () {
  var root = document.getElementById("nav-account");
  if (!root || !window.fetch) return;

  fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (me) {
      if (!me || !me.email) return;
      window.WardWiseUser = me;
      document.documentElement.dataset.signedIn = "true";
      if ((me.roles || []).indexOf("admin") !== -1) document.documentElement.dataset.admin = "true";

      var initial = String(me.email).charAt(0).toUpperCase();
      root.querySelector(".nav-avatar").textContent = initial;
      root.querySelector(".nav-account-button").setAttribute("title", me.email);
      root.querySelector(".visually-hidden").textContent = "Account menu for " + me.email;
      root.querySelector(".nav-account-email").textContent = me.email;
      var submissions = root.querySelector("[data-submissions-link]");
      if (submissions) submissions.hidden = !me.can_view_metric_submissions;
      root.hidden = false;

      // pages that branch on the reader's role (the dictionary's admin edit affordances) listen
      // for this rather than reading a server-rendered attribute
      document.dispatchEvent(new CustomEvent("wardwise:user", { detail: me }));
    })
    .catch(function () { /* offline or blocked: the page works signed-out */ });
})();
