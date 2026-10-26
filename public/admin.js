(function () {
  const KEY = "bktc-admin-token";
  const store = {
    get: () => { try { return sessionStorage.getItem(KEY); } catch { return null; } },
    set: (v) => { try { sessionStorage.setItem(KEY, v); } catch {} },
    clear: () => { try { sessionStorage.removeItem(KEY); } catch {} },
  };
  let token = store.get();
  let members = [];

  const $ = (id) => document.getElementById(id);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "");

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { logout(); throw new Error("Session expired. Log in again."); }
    if (!res.ok || !data.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function rows(tbody, items, cols) {
    tbody.replaceChildren(...items.map((item) => {
      const tr = document.createElement("tr");
      cols(item).forEach((v) => {
        const td = document.createElement("td");
        td.textContent = v ?? "";
        tr.append(td);
      });
      return tr;
    }));
  }

  async function load() {
    const [m, b, i] = await Promise.all([
      api("/api/admin/members"), api("/api/admin/broadcasts"), api("/api/admin/inbound"),
    ]);
    members = m.members;
    $("stat-total").textContent = members.length;
    $("stat-subscribed").textContent = members.filter((x) => x.smsOptIn).length;
    $("stat-optout").textContent = members.filter((x) => x.optedOutAt).length;
    rows($("members"), members, (x) => [x.name, x.phone, x.email, x.level, x.smsOptIn ? "Yes" : "No", fmt(x.createdAt)]);
    rows($("broadcasts"), b.broadcasts, (x) => [fmt(x.at), x.sent, x.failed, x.body]);
    rows($("inbound"), i.messages, (x) => [fmt(x.at), x.from, x.body]);
  }

  function showApp(on) {
    $("login").hidden = on;
    $("app").hidden = !on;
    $("logout").hidden = !on;
  }

  function logout() {
    token = null;
    store.clear();
    showApp(false);
  }

  $("login").addEventListener("submit", async (e) => {
    e.preventDefault();
    token = new FormData(e.target).get("token");
    $("login-status").textContent = "";
    try {
      await load();
      store.set(token);
      showApp(true);
    } catch (err) {
      $("login-status").textContent = err.message === "Session expired. Log in again." ? "Wrong token." : err.message;
    }
  });

  $("logout").addEventListener("click", logout);

  const textarea = $("compose").elements.body;
  textarea.addEventListener("input", () => {
    const n = textarea.value.length;
    // GSM-7 fits 160 chars per segment (153 when split); emoji/unicode drop that to 70 (67).
    const unicode = /[^\x00-\x7F£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà€]/.test(textarea.value);
    const [one, many] = unicode ? [70, 67] : [160, 153];
    const segments = n <= one ? 1 : Math.ceil(n / many);
    $("charcount").textContent = `${n} characters · ${segments} segment${segments > 1 ? "s" : ""}${unicode ? " (unicode)" : ""}`;
  });

  $("compose").addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || "test";
    const fd = new FormData(e.target);
    const body = fd.get("body").trim();
    const testTo = fd.get("testTo").trim();
    const status = $("compose-status");
    status.className = "form-status";

    if (mode === "test" && !testTo) { status.className = "form-status error"; status.textContent = "Enter a test number first."; return; }
    if (mode === "all") {
      const count = members.filter((x) => x.smsOptIn).length;
      if (!confirm(`Send this text to ${count} subscriber${count === 1 ? "" : "s"}?`)) return;
    }

    const buttons = e.target.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = "Sending…";
    try {
      const r = await api("/api/admin/broadcast", {
        method: "POST",
        body: JSON.stringify(mode === "test" ? { body, testTo } : { body }),
      });
      status.textContent = `Sent ${r.sent} of ${r.recipients}${r.failed.length ? `, ${r.failed.length} failed` : ""}.`;
      if (r.failed.length) status.className = "form-status error";
      if (!r.test) { e.target.elements.body.value = ""; await load(); }
    } catch (err) {
      status.className = "form-status error";
      status.textContent = err.message;
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });

  $("export").addEventListener("click", () => {
    const cols = ["name", "phone", "email", "level", "smsOptIn", "createdAt", "optedOutAt"];
    // Prefix cells that spreadsheets would treat as formulas (names come from the public form).
    const esc = (v) => `"${String(v ?? "").replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
    const csv = [cols.join(","), ...members.map((m) => cols.map((c) => esc(m[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `bktc-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  if (token) {
    load().then(() => showApp(true)).catch(() => logout());
  }
})();
