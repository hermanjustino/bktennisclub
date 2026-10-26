// BK Tennis Club server: serves public/, the enrollment API, the Twilio
// inbound webhook, and the admin SMS API. Runs on Cloud Run.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import twilio from "twilio";
import { toE164 } from "./phone.js";

const {
  PORT = 8080,
  ADMIN_TOKEN,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_SERVICE_SID,
  PUBLIC_URL, // e.g. https://bktennisclub.com, used to verify Twilio signatures
} = process.env;

// Shown on the form and stored with each opt-in as proof of consent.
// Bump the version whenever the wording changes.
export const CONSENT_VERSION = "2026-10-26";
export const CONSENT_TEXT =
  "Yes, text me BK Tennis Club session updates and event news. " +
  "Msg frequency varies (about 1-4/week). Msg & data rates may apply. " +
  "Reply STOP to opt out, HELP for help. Consent is not a condition of joining.";

const WELCOME_SMS =
  "BK Tennis Club: you're in! We'll text session times and event news. " +
  "Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

const LEVELS = new Set(["never-played", "beginner", "intermediate", "advanced"]);
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "YES", "UNSTOP", "OPTIN"]);

const db = new Firestore();
const members = db.collection("members");
const broadcasts = db.collection("broadcasts");

const sms = TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_MESSAGING_SERVICE_SID
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;
if (!sms) console.warn("Twilio not configured: SMS will be logged, not sent.");

async function sendSms(to, body) {
  if (!sms) {
    console.log(`[dry-run sms] to=${to} body=${JSON.stringify(body)}`);
    return { sid: "dry-run" };
  }
  return sms.messages.create({ messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID, to, body });
}

// Express 4 does not catch rejected promises; pass them to the error handler.
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

// ---------- Enrollment ----------

app.post("/api/enroll", express.json({ limit: "10kb" }), route(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields

  const name = str(b.name, 100);
  const email = str(b.email, 200).toLowerCase();
  const level = LEVELS.has(b.level) ? b.level : null;
  const phone = toE164(b.phone);
  const smsOptIn = b.smsOptIn === true;

  const errors = {};
  if (!name) errors.name = "Please enter your name.";
  if (!phone) errors.phone = "Please enter a valid US or Canadian mobile number.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "That email doesn't look right.";
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

  const ref = members.doc(phone);
  const now = FieldValue.serverTimestamp();
  let isNewOptIn = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists ? snap.data() : null;
    // Blank optional fields don't erase what a returning member gave before.
    const data = {
      name, phone,
      ...(email || !prev ? { email: email || null } : {}),
      ...(level || !prev ? { level } : {}),
      updatedAt: now,
      ...(prev ? {} : { createdAt: now, source: "website" }),
    };
    // Only ever turn SMS on from the form; turning it off happens via STOP.
    if (smsOptIn && !prev?.smsOptIn) {
      isNewOptIn = true;
      Object.assign(data, {
        smsOptIn: true,
        optedOutAt: null,
        consent: {
          text: CONSENT_TEXT,
          version: CONSENT_VERSION,
          at: now,
          ip: req.ip || null,
          userAgent: str(req.get("user-agent"), 300) || null,
        },
      });
    } else if (!prev) {
      data.smsOptIn = false;
    }
    tx.set(ref, data, { merge: true });
  });

  if (isNewOptIn) {
    try {
      await sendSms(phone, WELCOME_SMS);
    } catch (err) {
      console.error("welcome sms failed", phone, err.message);
    }
  }
  res.json({ ok: true, smsOptIn: smsOptIn || undefined });
}));

// ---------- Twilio inbound webhook (STOP/START/HELP) ----------

app.post("/api/sms/inbound", express.urlencoded({ extended: false }), route(async (req, res) => {
  if (sms) {
    const url = `${PUBLIC_URL || `https://${req.get("host")}`}${req.originalUrl}`;
    const valid = twilio.validateRequest(TWILIO_AUTH_TOKEN, req.get("x-twilio-signature") || "", url, req.body);
    if (!valid) return res.status(403).send("invalid signature");
  }

  const from = toE164(req.body.From || "");
  const word = str(req.body.Body, 160).toUpperCase().replace(/[^A-Z]/g, "");
  if (from) {
    const ref = members.doc(from);
    if (STOP_WORDS.has(word)) {
      await ref.set({ phone: from, smsOptIn: false, optedOutAt: FieldValue.serverTimestamp() }, { merge: true });
    } else if (START_WORDS.has(word)) {
      await ref.set({ phone: from, smsOptIn: true, optedOutAt: null, resubscribedAt: FieldValue.serverTimestamp() }, { merge: true });
    } else {
      // Keep any other replies so admins can read them.
      await db.collection("inbound").add({ from, body: str(req.body.Body, 1600), at: FieldValue.serverTimestamp() });
    }
  }
  // Twilio's Advanced Opt-Out sends the STOP/START/HELP auto-replies; reply with nothing.
  res.type("text/xml").send("<Response></Response>");
}));

// ---------- Admin ----------

function requireAdmin(req, res, next) {
  const token = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const ok = ADMIN_TOKEN && token.length === ADMIN_TOKEN.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(ADMIN_TOKEN));
  if (!ok) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

const ts = (t) => (t && t.toDate ? t.toDate().toISOString() : null);

app.get("/api/admin/members", requireAdmin, route(async (_req, res) => {
  const snap = await members.orderBy("createdAt", "desc").get();
  res.json({
    ok: true,
    members: snap.docs.map((d) => {
      const m = d.data();
      return {
        phone: m.phone, name: m.name || "", email: m.email || "", level: m.level || "",
        smsOptIn: !!m.smsOptIn, createdAt: ts(m.createdAt), optedOutAt: ts(m.optedOutAt),
      };
    }),
  });
}));

app.get("/api/admin/inbound", requireAdmin, route(async (_req, res) => {
  const snap = await db.collection("inbound").orderBy("at", "desc").limit(50).get();
  res.json({ ok: true, messages: snap.docs.map((d) => ({ ...d.data(), at: ts(d.data().at) })) });
}));

app.post("/api/admin/broadcast", requireAdmin, express.json({ limit: "20kb" }), route(async (req, res) => {
  const body = str(req.body?.body, 1600);
  if (!body) return res.status(400).json({ ok: false, error: "Message is empty." });

  // testTo: send only to one number to preview before blasting everyone.
  const testTo = req.body?.testTo ? toE164(req.body.testTo) : null;
  if (req.body?.testTo && !testTo) return res.status(400).json({ ok: false, error: "Invalid test number." });

  const recipients = testTo
    ? [testTo]
    : (await members.where("smsOptIn", "==", true).get()).docs.map((d) => d.id);

  if (!recipients.length) return res.status(400).json({ ok: false, error: "No one is subscribed yet." });

  let sent = 0;
  const failed = [];
  for (let i = 0; i < recipients.length; i += 10) {
    const batch = recipients.slice(i, i + 10);
    const results = await Promise.allSettled(batch.map((to) => sendSms(to, body)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") sent++;
      else failed.push({ to: batch[j], error: r.reason?.message || String(r.reason) });
    });
  }

  if (!testTo) {
    await broadcasts.add({ body, recipients: recipients.length, sent, failed: failed.length, at: FieldValue.serverTimestamp() });
  }
  res.json({ ok: true, test: !!testTo, recipients: recipients.length, sent, failed });
}));

app.get("/api/admin/broadcasts", requireAdmin, route(async (_req, res) => {
  const snap = await broadcasts.orderBy("at", "desc").limit(20).get();
  res.json({ ok: true, broadcasts: snap.docs.map((d) => ({ ...d.data(), at: ts(d.data().at) })) });
}));

// ---------- Static site ----------

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
app.use(express.static(publicDir, { maxAge: "1h", extensions: ["html"] }));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => console.log(`listening on :${PORT}`));
