const express = require("express");
const { normalizeUSPhone } = require("../lib/phone");
const { messages } = require("../lib/sms-text");

// Shown next to the sign-up checkbox on the homepage and stored with each consent.
// Change CONSENT_VERSION whenever this wording changes.
const CONSENT_VERSION = "2026-11-04";
const CONSENT_TEXT =
  "I agree to receive recurring text messages from BK Tennis Club about sessions and events " +
  "at the number provided. Consent is not a condition of anything. Msg frequency varies. " +
  "Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

const SIGNUP_WINDOW_MS = 10 * 60 * 1000;
const SIGNUPS_PER_WINDOW = 5;
const CONFIRM_RESEND_MS = 10 * 60 * 1000;

// Per-instance limiter: enough to blunt a script hammering the form (each sign-up
// can trigger a confirmation text, which costs money).
function createRateLimiter() {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < SIGNUP_WINDOW_MS);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length <= SIGNUPS_PER_WINDOW;
  };
}

function publicRoutes({ config, store, sender }) {
  const router = express.Router();
  const allow = createRateLimiter();

  router.get("/config", (req, res) => {
    res.json({ googleClientId: config.googleClientId, devAuth: Boolean(config.devAdminEmail) });
  });

  router.get("/groups", async (req, res) => {
    const groups = await store.listGroups();
    res.json(groups.filter((g) => g.public).map(({ id, name, description }) => ({ id, name, description })));
  });

  router.post("/signup", async (req, res) => {
    const { name, phone, groupIds, consent, website } = req.body || {};
    // Honeypot field, hidden from people. Bots that fill it get a fake success.
    if (website) return res.json({ status: "pending", message: "Thanks! Check your texts to confirm." });
    if (!allow(req.ip)) return res.status(429).json({ error: "Too many sign-ups from here. Try again in a few minutes." });

    const cleanName = String(name || "").trim().slice(0, 80);
    if (!cleanName) return res.status(400).json({ error: "Please enter your name." });
    const e164 = normalizeUSPhone(phone);
    if (!e164) return res.status(400).json({ error: "Please enter a valid US mobile number." });
    if (consent !== true) return res.status(400).json({ error: "Please check the box to agree to texts." });

    const publicGroups = (await store.listGroups()).filter((g) => g.public);
    const chosen = publicGroups.filter((g) => Array.isArray(groupIds) && groupIds.includes(g.id)).map((g) => g.id);
    if (chosen.length === 0) return res.status(400).json({ error: "Pick at least one group." });

    const existing = await store.getContact(e164);
    const groupIdsMerged = [...new Set([...((existing && existing.groups) || []), ...chosen])];
    const consentRecord = {
      source: "web",
      text: CONSENT_TEXT,
      version: CONSENT_VERSION,
      at: new Date().toISOString(),
      ip: req.ip,
      userAgent: String(req.get("user-agent") || "").slice(0, 300),
    };

    if (existing && existing.status === "subscribed") {
      await store.saveContact(e164, { groups: groupIdsMerged, consent: consentRecord });
      return res.json({ status: "subscribed", message: "You're already on the list. We've added any new groups you picked." });
    }

    await store.saveContact(e164, { name: cleanName, groups: groupIdsMerged, status: "pending", consent: consentRecord });

    if (!sender.enabled) {
      return res.json({ status: "pending", message: "Thanks! We'll text you to confirm soon." });
    }

    const lastSent = existing && existing.confirmationSentAt ? Date.parse(existing.confirmationSentAt) : 0;
    if (Date.now() - lastSent > CONFIRM_RESEND_MS) {
      const names = publicGroups.filter((g) => groupIdsMerged.includes(g.id)).map((g) => g.name);
      try {
        await sender.send(e164, messages.confirm(names));
        await store.saveContact(e164, { confirmationSentAt: new Date().toISOString() });
      } catch (err) {
        if (err.code === 21610) {
          return res.status(409).json({
            error: "This number previously replied STOP to our texts. Reply START to one of those texts, then sign up again.",
          });
        }
        console.error("signup confirmation failed", err.message);
        return res.status(502).json({ error: "We couldn't send the confirmation text. Please try again later." });
      }
    }
    res.json({ status: "pending", message: "Almost done! Reply YES to the text we just sent you." });
  });

  return router;
}

module.exports = { publicRoutes, CONSENT_TEXT, CONSENT_VERSION };
