(function () {
  document.getElementById("year").textContent = new Date().getFullYear();

  // Mobile nav
  const toggle = document.querySelector(".nav-toggle");
  const links = document.getElementById("nav-links");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
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

  const card = (e) => {
    const el = document.createElement("article");
    el.className = "card event";

    const date = document.createElement("p");
    date.className = "event-date";
    date.textContent = e._date.toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    }) + (e.time ? ` · ${e.time}` : "");

    const title = document.createElement("h3");
    title.textContent = e.title;

    el.append(date, title);

    if (e.location) {
      const loc = document.createElement("p");
      loc.className = "muted";
      loc.textContent = e.location;
      el.append(loc);
    }
    if (e.description) {
      const desc = document.createElement("p");
      desc.textContent = e.description;
      el.append(desc);
    }
    if (e.link) {
      const a = document.createElement("a");
      a.href = e.link;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "btn btn-small";
      a.textContent = e.linkLabel || "Details";
      el.append(a);
    }
    return el;
  };

  const upEl = document.getElementById("events-upcoming");
  const pastEl = document.getElementById("events-past");
  upcoming.forEach((e) => upEl.append(card(e)));
  past.forEach((e) => pastEl.append(card(e)));
  document.getElementById("events-empty").hidden = upcoming.length > 0;
  document.querySelector(".past-events").hidden = past.length === 0;
})();

// Enrollment form
(function () {
  const form = document.getElementById("enroll-form");
  if (!form) return;
  const status = document.getElementById("enroll-status");
  const button = form.querySelector("button[type=submit]");

  const setErrors = (errors) => {
    form.querySelectorAll(".field-error").forEach((el) => {
      el.textContent = (errors && errors[el.dataset.for]) || "";
    });
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setErrors(null);
    status.className = "form-status";
    status.textContent = "";
    button.disabled = true;

    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      phone: fd.get("phone"),
      email: fd.get("email"),
      level: fd.get("level"),
      website: fd.get("website"),
      smsOptIn: fd.get("smsOptIn") === "on",
    };

    try {
      const res = await fetch("/api/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        form.reset();
        status.textContent = payload.smsOptIn
          ? "You're in! Check your phone for a welcome text."
          : "You're in! See you on court.";
      } else {
        setErrors(data.errors);
        status.className = "form-status error";
        status.textContent = data.errors ? "Please fix the fields above." : (data.error || "Something went wrong. Please try again.");
      }
    } catch {
      status.className = "form-status error";
      status.textContent = "Couldn't reach the server. Please try again.";
    } finally {
      button.disabled = false;
    }
  });
})();
