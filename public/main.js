(function () {
  document.getElementById("year").textContent = new Date().getFullYear();

  // Mobile nav
  const toggle = document.querySelector(".nav-toggle");
  const links = document.getElementById("nav-links");
  const setOpen = (open) => {
    links.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
  links.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  // Events
  const parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const events = (window.EVENTS || [])
    .map((e) => ({ ...e, _date: parseDate(e.date) }))
    .sort((a, b) => a._date - b._date);
  const upcoming = events.filter((e) => e._date >= today);
  const past = events.filter((e) => e._date < today).reverse();

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const card = (e, isPast) => {
    const article = el("article", isPast ? "event past" : "event");

    const date = el("div", isPast ? "event-date" : "event-date checker");
    date.append(
      el("span", "dow", e._date.toLocaleDateString("en-US", { weekday: "short" })),
      el("span", "day", String(e._date.getDate()).padStart(2, "0")),
      el("span", "mon", e._date.toLocaleDateString("en-US", { month: "short" }))
    );

    const body = el("div", "event-body");
    body.append(
      el("span", isPast ? "pill pill-cream" : "pill", isPast ? "Past event" : "Upcoming"),
      el("h3", "", e.title)
    );
    const meta = [e.time, e.location].filter(Boolean).join(" · ");
    if (meta) body.append(el("p", "event-meta", meta));
    if (e.description) body.append(el("p", "", e.description));

    article.append(date, body);

    if (e.link) {
      const action = el("div", "event-action");
      const a = el("a", isPast ? "" : "btn btn-accent", isPast ? "Event page" : e.linkLabel || "Details");
      a.href = e.link;
      a.target = "_blank";
      a.rel = "noopener";
      if (isPast) a.style.fontWeight = "700";
      action.append(a);
      article.append(action);
    }
    return article;
  };

  const upEl = document.getElementById("events-upcoming");
  const pastEl = document.getElementById("events-past");
  upcoming.forEach((e) => upEl.append(card(e, false)));
  past.forEach((e) => pastEl.append(card(e, true)));
  document.querySelector(".past-events").hidden = past.length === 0;
})();

// SMS sign-up
(function () {
  const form = document.getElementById("signup-form");
  if (!form) return;
  const groupsEl = document.getElementById("signup-groups");
  const status = document.getElementById("signup-status");
  const button = form.querySelector('button[type="submit"]');

  const say = (text, isError) => {
    status.textContent = text;
    status.classList.toggle("error", Boolean(isError));
  };

  fetch("/api/groups")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((groups) => {
      groupsEl.textContent = "";
      if (groups.length === 0) {
        groupsEl.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Sign-ups open soon." }));
        button.disabled = true;
        return;
      }
      groups.forEach((g, i) => {
        const label = document.createElement("label");
        label.className = "group-choice";
        const input = Object.assign(document.createElement("input"), { type: "checkbox", name: "groupIds", value: g.id, checked: i === 0 });
        const text = document.createElement("span");
        text.append(Object.assign(document.createElement("strong"), { textContent: g.name }));
        if (g.description) text.append(Object.assign(document.createElement("span"), { textContent: g.description }));
        label.append(input, text);
        groupsEl.append(label);
      });
    })
    .catch(() => {
      groupsEl.textContent = "Couldn't load groups. Refresh to try again.";
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload = {
      name: data.get("name"),
      phone: data.get("phone"),
      groupIds: data.getAll("groupIds"),
      consent: data.get("consent") === "on",
      website: data.get("website"),
    };
    if (!String(payload.name).trim()) return say("Please enter your name.", true);
    if (!String(payload.phone).trim()) return say("Please enter your mobile number.", true);
    if (payload.groupIds.length === 0) return say("Pick at least one group.", true);
    if (!payload.consent) return say("Please check the box to agree to texts.", true);

    button.disabled = true;
    say("Signing you up…");
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
      say(body.message);
      form.reset();
    } catch (err) {
      say(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
})();
