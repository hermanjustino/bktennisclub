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
