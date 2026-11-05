(function () {
  const { countSegments, personalize, STOP_FOOTER } = window.SmsText;
  const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.6.0";
  const EMAIL_KEY = "bk_admin_signin_email";

  const state = { dev: false, me: null, summary: null, contacts: null, tab: "send", openBlastId: null, signInError: "" };
  let fb = null; // Firebase Auth module functions plus the auth instance

  const storage = {
    get: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {}
    },
  };

  const $ = (id) => document.getElementById(id);

  // Tiny element builder. Text always goes in as text nodes, never HTML.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "value" || key === "checked" || key === "disabled") el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  const formatPhone = (p) => {
    const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p || "");
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || "";
  };
  const formatDate = (iso) =>
    iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // iOS wants sms:NUMBER&body=..., everyone else sms:NUMBER?body=...
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const smsHref = (phone, text) => `sms:${phone}${isIOS ? "&" : "?"}body=${encodeURIComponent(text)}`;

  async function copy(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("Couldn't copy. Your browser blocked the clipboard.", true);
    }
  }

  let toastTimer;
  function toast(text, isError) {
    const el = $("toast");
    el.textContent = text;
    el.classList.toggle("error", Boolean(isError));
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  // API
  async function api(path, options = {}) {
    const headers = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (state.dev) headers["x-dev-admin"] = "1";
    // getIdToken() returns a cached token and refreshes it when it's near expiry.
    else if (fb && fb.auth.currentUser) headers.Authorization = `Bearer ${await fb.auth.currentUser.getIdToken()}`;
    const res = await fetch(`/api/admin${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      signOut(data.error);
      throw new Error(data.error || "Please sign in again.");
    }
    if (!res.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  // Run an action from a button: disables it while working and reports errors.
  async function withButton(button, fn) {
    button.disabled = true;
    try {
      await fn();
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  }

  // Sign-in: Firebase email links. Enter your email, open the link we send, done.
  let config = null;

  function showSignIn(error) {
    $("app").hidden = true;
    $("account").hidden = true;
    $("signin").hidden = false;
    $("signin-sent").hidden = true;
    $("signin-form").hidden = !config.firebase;
    $("signin-error").textContent = error || "";
    if (config.devAuth) $("dev-signin").hidden = false;
    if (!config.firebase && !config.devAuth) $("signin-error").textContent = "Sign-in isn't configured yet.";
  }

  async function loadFirebase() {
    const [{ initializeApp }, authModule] = await Promise.all([
      import(`${FIREBASE_SDK}/firebase-app.js`),
      import(`${FIREBASE_SDK}/firebase-auth.js`),
    ]);
    fb = { ...authModule, auth: authModule.getAuth(initializeApp(config.firebase)) };
  }

  // Coming back from the emailed link: finish signing in, then tidy the URL.
  async function completeEmailLink() {
    if (!fb.isSignInWithEmailLink(fb.auth, location.href)) return;
    let email = storage.get(EMAIL_KEY);
    // Opened on a different device than the one that asked for the link.
    if (!email) email = window.prompt("Confirm your email to finish signing in");
    try {
      if (email) await fb.signInWithEmailLink(fb.auth, email.trim(), location.href);
    } catch {
      state.signInError = "That sign-in link has expired or was already used. Request a new one.";
    }
    storage.set(EMAIL_KEY, null);
    history.replaceState(null, "", "/admin/");
  }

  async function sendLink(event) {
    event.preventDefault();
    const input = $("signin-email");
    const button = $("signin-form").querySelector("button");
    const email = input.value.trim();
    if (!email) return ($("signin-error").textContent = "Enter your email.");
    button.disabled = true;
    $("signin-error").textContent = "";
    try {
      await fb.sendSignInLinkToEmail(fb.auth, email, { url: `${location.origin}/admin/`, handleCodeInApp: true });
      storage.set(EMAIL_KEY, email);
      $("signin-form").hidden = true;
      $("signin-sent-email").textContent = email;
      $("signin-sent").hidden = false;
    } catch (err) {
      $("signin-error").textContent =
        err && err.code === "auth/invalid-email" ? "That email doesn't look right." : "Couldn't send the link. Try again in a minute.";
    } finally {
      button.disabled = false;
    }
  }

  async function signOut(error) {
    state.dev = false;
    state.signInError = error || "";
    if (fb && fb.auth.currentUser) await fb.signOut(fb.auth); // onAuthStateChanged shows the sign-in screen
    else showSignIn(state.signInError);
  }

  async function start() {
    try {
      state.me = await api("/me");
    } catch {
      return;
    }
    $("signin").hidden = true;
    $("app").hidden = false;
    $("account").hidden = false;
    $("account-email").textContent = state.me.email;
    $("sms-banner").hidden = state.me.smsEnabled;
    // Replies only arrive through Twilio; in manual mode they land on your phone.
    document.querySelector('[data-tab="replies"]').hidden = !state.me.smsEnabled;
    await refreshSummary();
    showTab(state.tab);
  }

  async function refreshSummary() {
    state.summary = await api("/summary");
    const t = state.summary.totals;
    $("totals").replaceChildren(
      h("div", { class: "stat" }, h("strong", {}, t.subscribed), h("span", {}, "Subscribed")),
      h("div", { class: "stat" }, h("strong", {}, t.pending), h("span", {}, "Waiting to confirm")),
      h("div", { class: "stat" }, h("strong", {}, t.unsubscribed), h("span", {}, "Opted out")),
      h("div", { class: "stat" }, h("strong", {}, state.summary.groups.length), h("span", {}, "Groups"))
    );
  }

  // Tabs
  const renderers = { send: renderSend, contacts: renderContacts, groups: renderGroups, history: renderHistory, replies: renderReplies };

  function showTab(name) {
    state.tab = name;
    document.querySelectorAll(".tabs button").forEach((b) => {
      if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${name}`));
    renderers[name]($(`tab-${name}`)).catch((err) => toast(err.message, true));
  }

  function groupCheckboxes(name, selected, withCounts) {
    return state.summary.groups.map((g) =>
      h(
        "label",
        { class: "group-choice" },
        h("input", { type: "checkbox", name, value: g.id, checked: selected.includes(g.id) }),
        h("span", {}, h("strong", {}, g.name), withCounts ? h("small", {}, `${g.subscribed} subscribed`) : null)
      )
    );
  }
  const checkedValues = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

  // Send
  async function renderSend(panel) {
    if (state.openBlastId) {
      const id = state.openBlastId;
      state.openBlastId = null;
      return renderManualList(panel, await api(`/blasts/${encodeURIComponent(id)}`));
    }
    const manual = !state.me.smsEnabled;
    const body = h("textarea", { class: "admin-input", id: "blast-body", maxlength: "1600", placeholder: "Hey {first_name}! Courts 3 & 4 tonight at 7. See you there." });
    const footer = h("input", { type: "checkbox", checked: true });
    const counter = h("div", { class: "counter" });
    const bubble = h("div", { class: "bubble" });
    const groups = h("div", { class: "group-options" }, groupCheckboxes("blast-groups", [], true));
    const testPhone = h("input", { class: "admin-input", type: "tel", placeholder: "Your mobile number", autocomplete: "tel" });
    const sendBtn = h("button", { type: "button", class: "btn btn-lg btn-ink" }, manual ? "Prepare texts" : "Send blast");
    const testBtn = h("button", { type: "button", class: "btn" }, "Send test");
    let recipients = 0;

    const fullText = () => (footer.checked ? body.value.trim() + STOP_FOOTER : body.value.trim());

    function update() {
      const text = fullText();
      const info = countSegments(text);
      const sample = personalize(text, { name: "Alex" });
      bubble.textContent = body.value.trim() ? sample : "Your message preview shows here.";
      bubble.classList.toggle("empty", !body.value.trim());
      counter.replaceChildren(
        h("span", {}, `${info.length} characters`),
        h("span", { class: info.segments > 2 ? "warn" : "" }, `${plural(info.segments, "text")} each (${info.encoding})`),
        h("span", {}, `${plural(recipients, "recipient")}`),
        h("span", {}, `≈ ${info.segments * recipients} texts total`)
      );
    }

    async function updateRecipients() {
      const groupIds = checkedValues(groups, "blast-groups");
      recipients = groupIds.length ? (await api("/blasts/preview", { method: "POST", body: { groupIds } })).recipients : 0;
      update();
    }

    body.addEventListener("input", update);
    footer.addEventListener("change", update);
    groups.addEventListener("change", () => updateRecipients().catch((err) => toast(err.message, true)));

    sendBtn.addEventListener("click", () =>
      withButton(sendBtn, async () => {
        const groupIds = checkedValues(groups, "blast-groups");
        if (!body.value.trim()) throw new Error("Write a message first.");
        if (!groupIds.length) throw new Error("Pick at least one group.");
        if (recipients === 0) throw new Error("Nobody in those groups is subscribed yet.");
        const payload = { body: body.value.trim(), groupIds, addFooter: footer.checked };
        if (manual) return renderManualList(panel, await api("/blasts", { method: "POST", body: payload }));
        if (!confirm(`Send this message to ${plural(recipients, "person")}?`)) return;
        const blast = await api("/blasts", { method: "POST", body: payload });
        toast(`Sent: ${blast.accepted} accepted${blast.rejected ? `, ${blast.rejected} failed` : ""}.`, blast.rejected > 0);
        body.value = "";
        update();
      })
    );

    testBtn.addEventListener("click", () =>
      withButton(testBtn, async () => {
        const result = await api("/blasts/test", { method: "POST", body: { phone: testPhone.value, body: fullText() } });
        toast("Test sent. Check your phone.");
      })
    );

    panel.replaceChildren(
      h(
        "div",
        { class: "box" },
        h("h2", {}, "New blast"),
        h(
          "div",
          { class: "box-row" },
          h(
            "div",
            { style: "display:flex;flex-direction:column;gap:16px" },
            h("fieldset", { class: "group-options" }, h("legend", {}, "Send to"), groups),
            h("label", { class: "field", for: "blast-body" }, h("span", {}, "Message")),
            body,
            h("p", { class: "hint" }, "Use {first_name} to drop in each person's first name."),
            h("label", { class: "check" }, footer, "Add “Reply STOP to opt out”"),
            counter,
            h("div", { class: "btn-group" }, sendBtn)
          ),
          h(
            "div",
            { style: "display:flex;flex-direction:column;gap:16px" },
            h("div", { class: "phone-preview" }, bubble, h("p", {}, "Preview, as “Alex” would see it")),
            manual
              ? h("p", { class: "hint" }, "Next you'll get a list with a Text button for each person. Each one opens Messages with their personalized text ready to send.")
              : h(
                  "div",
                  { class: "field-inline" },
                  h("label", { class: "field" }, h("span", {}, "Test it on your phone first"), testPhone),
                  testBtn
                )
          )
        )
      )
    );
    update();
  }

  // Manual mode: one row per person with a Text button that opens Messages
  // pre-filled. Ticks are saved on the server, so the list survives a reload.
  function renderManualList(panel, blast) {
    const sent = new Set(blast.sentTo || []);
    const progress = h("p", { class: "progress-line" });
    const rows = blast.list.map((r) => {
      const box = h("input", { type: "checkbox", "aria-label": `Mark ${r.name || formatPhone(r.phone)} as sent` });
      const link = h("a", { class: "btn btn-accent", href: smsHref(r.phone, r.text) }, "Text");
      const row = h(
        "li",
        { class: "send-row" },
        h("div", { class: "send-who" }, h("strong", {}, r.name || formatPhone(r.phone)), h("span", {}, formatPhone(r.phone))),
        h("label", { class: "check" }, box, "Sent"),
        link
      );
      box.addEventListener("change", () => mark(r.phone, box.checked));
      link.addEventListener("click", () => mark(r.phone, true));
      return { row, box, phone: r.phone };
    });

    function sync() {
      rows.forEach((x) => {
        x.box.checked = sent.has(x.phone);
        x.row.classList.toggle("done", sent.has(x.phone));
      });
      const all = blast.list.length;
      progress.textContent = `${sent.size} of ${all} sent${all && sent.size === all ? ". All done!" : ""}`;
    }

    async function mark(phone, value) {
      if (value) sent.add(phone);
      else sent.delete(phone);
      sync();
      try {
        const updated = await api(`/blasts/${encodeURIComponent(blast.id)}/sent`, { method: "POST", body: { phone, sent: value } });
        sent.clear();
        (updated.sentTo || []).forEach((p) => sent.add(p));
      } catch (err) {
        toast(err.message, true);
      }
      sync();
    }

    const personalized = /\{(first_)?name\}/i.test(blast.body);
    panel.replaceChildren(
      h(
        "div",
        { class: "box" },
        h("h2", {}, "Send from your phone"),
        h(
          "p",
          {},
          "Tap Text to open Messages with the number and message filled in. Send it, come back, and tap the next one. Your progress saves automatically."
        ),
        h("div", { class: "bubble" }, blast.body),
        progress,
        blast.list.length
          ? h("ol", { class: "send-list" }, rows.map((x) => x.row))
          : h("p", { class: "empty-state" }, "Nobody in those groups is subscribed yet."),
        h(
          "div",
          { class: "btn-group" },
          h("button", { type: "button", class: "btn", onclick: () => copy(blast.list.map((r) => r.phone).join(", "), "Numbers copied.") }, "Copy all numbers"),
          h(
            "button",
            {
              type: "button",
              class: "btn",
              onclick: () => copy(blast.body, personalized ? "Copied. It still has {first_name} in it, so the Text buttons are better." : "Message copied."),
            },
            "Copy message"
          ),
          h("button", { type: "button", class: "btn btn-ink", onclick: () => renderSend(panel) }, "Write a new message")
        )
      )
    );
    sync();
  }

  // Contacts
  async function renderContacts(panel) {
    state.contacts = await api("/contacts");
    const groupName = Object.fromEntries(state.summary.groups.map((g) => [g.id, g.name]));
    const search = h("input", { class: "admin-input", type: "search", placeholder: "Search name or number", "aria-label": "Search contacts" });
    const groupFilter = h(
      "select",
      { class: "admin-input", "aria-label": "Filter by group" },
      h("option", { value: "" }, "All groups"),
      state.summary.groups.map((g) => h("option", { value: g.id }, g.name))
    );
    const statusFilter = h(
      "select",
      { class: "admin-input", "aria-label": "Filter by status" },
      h("option", { value: "" }, "Any status"),
      h("option", { value: "subscribed" }, "Subscribed"),
      h("option", { value: "pending" }, "Waiting to confirm"),
      h("option", { value: "unsubscribed" }, "Opted out")
    );
    const tbody = h("tbody");
    const countLine = h("p", { class: "hint" });

    function draw() {
      const q = search.value.trim().toLowerCase();
      const digits = q.replace(/\D/g, "");
      const rows = state.contacts.filter(
        (c) =>
          (!groupFilter.value || (c.groups || []).includes(groupFilter.value)) &&
          (!statusFilter.value || c.status === statusFilter.value) &&
          (!q || (c.name || "").toLowerCase().includes(q) || (digits && c.phone.includes(digits)))
      );
      countLine.textContent = `Showing ${rows.length} of ${plural(state.contacts.length, "contact")}`;
      tbody.replaceChildren(
        ...(rows.length
          ? rows.map((c) =>
              h(
                "tr",
                {},
                h("td", {}, c.name || "—"),
                h("td", { style: "white-space:nowrap" }, formatPhone(c.phone)),
                h("td", {}, (c.groups || []).map((id) => groupName[id]).filter(Boolean).join(", ") || "—"),
                h("td", {}, h("span", { class: `tag ${c.status}` }, c.status === "pending" ? "waiting" : c.status)),
                h("td", { style: "white-space:nowrap" }, formatDate(c.createdAt)),
                h(
                  "td",
                  {},
                  h(
                    "div",
                    { class: "row-actions" },
                    h("button", { type: "button", class: "link-btn", onclick: () => editContact(c) }, "Edit"),
                    c.status !== "unsubscribed"
                      ? h("button", { type: "button", class: "link-btn", onclick: (e) => unsubscribe(c, e.currentTarget) }, "Stop texts")
                      : null,
                    h("button", { type: "button", class: "link-btn danger", onclick: (e) => removeContact(c, e.currentTarget) }, "Delete")
                  )
                )
              )
            )
          : [h("tr", {}, h("td", { colspan: "6", class: "empty-state" }, "No contacts match."))])
      );
    }
    [search, groupFilter, statusFilter].forEach((el) => el.addEventListener("input", draw));

    async function reload() {
      state.contacts = await api("/contacts");
      await refreshSummary();
      draw();
    }

    async function unsubscribe(c, button) {
      if (!confirm(`Stop texting ${c.name || formatPhone(c.phone)}? Only they can opt back in, by texting START.`)) return;
      await withButton(button, async () => {
        await api(`/contacts/${encodeURIComponent(c.phone)}`, { method: "PATCH", body: { status: "unsubscribed" } });
        await reload();
      });
    }

    async function removeContact(c, button) {
      if (!confirm(`Delete ${c.name || formatPhone(c.phone)} and their consent record? This can't be undone.`)) return;
      await withButton(button, async () => {
        await api(`/contacts/${encodeURIComponent(c.phone)}`, { method: "DELETE" });
        await reload();
      });
    }

    function editContact(c) {
      const dialog = $("edit-contact");
      const form = $("edit-contact-form");
      const error = form.querySelector(".form-error");
      form.elements.name.value = c.name || "";
      form.querySelector("[data-groups]").replaceChildren(...groupCheckboxes("edit-groups", c.groups || [], false));
      error.textContent = "";
      form.onsubmit = async (e) => {
        if (e.submitter && e.submitter.value === "cancel") return;
        e.preventDefault();
        try {
          await api(`/contacts/${encodeURIComponent(c.phone)}`, {
            method: "PATCH",
            body: { name: form.elements.name.value, groups: checkedValues(form, "edit-groups") },
          });
          dialog.close();
          await reload();
        } catch (err) {
          error.textContent = err.message;
        }
      };
      dialog.showModal();
    }

    // Add someone by hand
    const addName = h("input", { class: "admin-input", maxlength: "80" });
    const addPhone = h("input", { class: "admin-input", type: "tel" });
    const addGroups = h("div", { class: "group-options" }, groupCheckboxes("add-groups", [], false));
    const attest = h("input", { type: "checkbox" });
    const addBtn = h("button", { type: "button", class: "btn btn-ink" }, "Add contact");
    addBtn.addEventListener("click", () =>
      withButton(addBtn, async () => {
        await api("/contacts", {
          method: "POST",
          body: { name: addName.value, phone: addPhone.value, groupIds: checkedValues(addGroups, "add-groups"), attest: attest.checked },
        });
        addName.value = "";
        addPhone.value = "";
        attest.checked = false;
        toast("Contact added.");
        await reload();
      })
    );

    const pending = state.contacts.filter((c) => c.status === "pending").length;
    const confirmBtn = h("button", { type: "button", class: "btn" }, `Text confirmation to ${plural(pending, "waiting contact")}`);
    confirmBtn.addEventListener("click", () =>
      withButton(confirmBtn, async () => {
        const result = await api("/contacts/send-confirmations", { method: "POST" });
        toast(`Sent ${plural(result.sent, "confirmation")}.`);
        await reload();
      })
    );

    panel.replaceChildren(
      h(
        "details",
        { class: "box" },
        h("summary", { style: "cursor:pointer;font-weight:700;font-size:18px" }, "Add a contact by hand"),
        h(
          "div",
          { class: "field-row" },
          h("label", { class: "field" }, h("span", {}, "Name"), addName),
          h("label", { class: "field" }, h("span", {}, "Mobile number (US)"), addPhone)
        ),
        h("fieldset", { class: "group-options" }, h("legend", {}, "Groups"), addGroups),
        h("label", { class: "consent" }, attest, h("span", {}, "This person told me they want texts from BK Tennis Club. (Required by carriers. Use the sign-up form when you can.)")),
        h("div", {}, addBtn)
      ),
      h(
        "div",
        { class: "box" },
        h("div", { class: "filters" }, search, groupFilter, statusFilter),
        pending && state.me.smsEnabled ? h("div", {}, confirmBtn) : null,
        state.me.smsEnabled
          ? null
          : h("p", { class: "hint" }, "Someone replied STOP to your texts? Click “Stop texts” next to their name so they're left off future lists."),
        countLine,
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, ["Name", "Phone", "Groups", "Status", "Joined", ""].map((t) => h("th", { scope: "col" }, t)))),
            tbody
          )
        )
      )
    );
    draw();
  }

  // Groups
  async function renderGroups(panel) {
    await refreshSummary();

    function groupForm(group, onSave, onCancel) {
      const name = h("input", { class: "admin-input", maxlength: "60", value: group ? group.name : "" });
      const description = h("input", { class: "admin-input", maxlength: "200", value: group ? group.description || "" : "" });
      const isPublic = h("input", { type: "checkbox", checked: group ? Boolean(group.public) : true });
      const save = h("button", { type: "button", class: "btn btn-ink" }, group ? "Save" : "Add group");
      save.addEventListener("click", () =>
        withButton(save, () => onSave({ name: name.value, description: description.value, public: isPublic.checked }))
      );
      return h(
        "div",
        { style: "display:flex;flex-direction:column;gap:14px" },
        h(
          "div",
          { class: "field-row" },
          h("label", { class: "field" }, h("span", {}, "Name"), name),
          h("label", { class: "field" }, h("span", {}, "Description (shown on the sign-up form)"), description)
        ),
        h("label", { class: "check" }, isPublic, "Show on the public sign-up form"),
        h("div", { class: "btn-group" }, save, onCancel ? h("button", { type: "button", class: "btn", onclick: onCancel }, "Cancel") : null)
      );
    }

    const rerender = () => renderGroups(panel);

    const cards = state.summary.groups.map((g) => {
      const card = h("div", { class: "box" });
      const view = () =>
        card.replaceChildren(
          h(
            "div",
            { class: "group-card" },
            h(
              "div",
              { style: "display:flex;flex-direction:column;gap:6px" },
              h("h3", {}, g.name, " ", h("span", { class: `tag ${g.public ? "subscribed" : "pending"}` }, g.public ? "on sign-up form" : "hidden")),
              g.description ? h("p", {}, g.description) : null,
              h("p", { class: "counts" }, `${g.subscribed} subscribed · ${g.pending} waiting to confirm`)
            ),
            h(
              "div",
              { class: "row-actions" },
              h("button", { type: "button", class: "link-btn", onclick: edit }, "Edit"),
              h(
                "button",
                {
                  type: "button",
                  class: "link-btn danger",
                  onclick: (e) => {
                    if (!confirm(`Delete “${g.name}”? Contacts stay, but they'll be removed from this group.`)) return;
                    withButton(e.currentTarget, async () => {
                      await api(`/groups/${encodeURIComponent(g.id)}`, { method: "DELETE" });
                      await rerender();
                    });
                  },
                },
                "Delete"
              )
            )
          )
        );
      const edit = () =>
        card.replaceChildren(
          groupForm(
            g,
            async (fields) => {
              await api(`/groups/${encodeURIComponent(g.id)}`, { method: "PATCH", body: fields });
              await rerender();
            },
            view
          )
        );
      view();
      return card;
    });

    panel.replaceChildren(
      ...cards,
      h(
        "div",
        { class: "box" },
        h("h2", {}, "New group"),
        groupForm(null, async (fields) => {
          await api("/groups", { method: "POST", body: fields });
          toast("Group added.");
          await rerender();
        })
      )
    );
  }

  // History
  async function renderHistory(panel) {
    const blasts = await api("/blasts");
    if (!blasts.length) {
      panel.replaceChildren(h("div", { class: "box empty-state" }, "No blasts yet. Send one from the Send tab."));
      return;
    }
    panel.replaceChildren(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          {},
          h(
            "thead",
            {},
            h("tr", {}, ["Created", "Message", "Groups", "Recipients", "Progress", "Status", "By", ""].map((t) => h("th", { scope: "col" }, t)))
          ),
          h(
            "tbody",
            {},
            blasts.map((b) =>
              h(
                "tr",
                {},
                h("td", { style: "white-space:nowrap" }, formatDate(b.createdAt)),
                h("td", {}, h("div", { class: "msg" }, b.body)),
                h("td", {}, (b.groupNames || []).join(", ")),
                h("td", { class: "num" }, b.recipients),
                h(
                  "td",
                  {},
                  b.mode === "manual"
                    ? `${(b.sentTo || []).length} of ${b.recipients} texted`
                    : `${b.accepted} accepted · ${b.delivered || 0} delivered · ${(b.rejected || 0) + (b.failed || 0)} failed`
                ),
                h("td", {}, h("span", { class: `tag ${b.status}` }, b.status === "in_progress" ? "in progress" : b.status)),
                h("td", {}, b.createdBy),
                h(
                  "td",
                  {},
                  b.mode === "manual" && b.recipients
                    ? h(
                        "button",
                        {
                          type: "button",
                          class: "link-btn",
                          onclick: () => {
                            state.openBlastId = b.id;
                            showTab("send");
                          },
                        },
                        b.status === "done" ? "Open" : "Continue"
                      )
                    : null
                )
              )
            )
          )
        )
      )
    );
  }

  // Replies
  async function renderReplies(panel) {
    const inbound = await api("/inbox");
    if (!inbound.length) {
      panel.replaceChildren(h("div", { class: "box empty-state" }, "No replies yet. Texts people send back show up here."));
      return;
    }
    panel.replaceChildren(
      h(
        "div",
        { class: "table-wrap" },
        inbound.map((m) =>
          h(
            "div",
            { class: "reply" },
            h(
              "div",
              { class: "who" },
              m.contactName ? `${m.contactName} · ${formatPhone(m.from)}` : formatPhone(m.from),
              m.keyword ? h("span", { class: "tag pending", style: "margin-left:8px" }, m.keyword) : null
            ),
            h("time", { datetime: m.receivedAt }, formatDate(m.receivedAt)),
            h("div", { class: "body" }, m.body)
          )
        )
      )
    );
  }

  // Boot
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("sign-out").addEventListener("click", () => signOut());
  $("signin-form").addEventListener("submit", sendLink);
  $("signin-retry").addEventListener("click", () => showSignIn());
  $("dev-signin").addEventListener("click", () => {
    state.dev = true;
    start();
  });

  (async () => {
    try {
      config = await (await fetch("/api/config")).json();
    } catch {
      return toast("Couldn't reach the server.", true);
    }
    if (!config.firebase) return showSignIn();
    try {
      await loadFirebase();
    } catch {
      return showSignIn("Couldn't load sign-in. Check your connection and refresh.");
    }
    await completeEmailLink();
    // Show the form straight away; a saved session swaps it for the dashboard.
    if (!fb.auth.currentUser) showSignIn(state.signInError);
    fb.onAuthStateChanged(fb.auth, (user) => {
      if (user) return start();
      showSignIn(state.signInError);
      state.signInError = "";
    });
  })();
})();
