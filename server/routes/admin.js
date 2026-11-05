const express = require("express");
const { normalizeUSPhone } = require("../lib/phone");
const { messages, personalize } = require("../lib/sms-text");
const { sendBlast, prepareManualBlast, recipientsFor } = require("../blast");

const MAX_BODY = 1600; // Twilio's limit for a single (multi-segment) message
const ADMIN_ATTEST_TEXT = "Admin confirmed this person gave permission to receive texts.";

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function cleanGroupFields(body) {
  const name = String((body && body.name) || "").trim().slice(0, 60);
  const description = String((body && body.description) || "").trim().slice(0, 200);
  return { name, description, public: Boolean(body && body.public) };
}

function adminRoutes({ store, sender, requireAdmin }) {
  const router = express.Router();
  router.use(requireAdmin);

  const validGroupIds = async (ids) => {
    const known = new Set((await store.listGroups()).map((g) => g.id));
    return Array.isArray(ids) ? [...new Set(ids)].filter((id) => known.has(id)) : [];
  };

  router.get("/me", (req, res) => {
    res.json({ email: req.admin.email, name: req.admin.name, smsEnabled: sender.enabled, store: store.kind });
  });

  router.get("/summary", asyncRoute(async (req, res) => {
    const [groups, contacts] = await Promise.all([store.listGroups(), store.listContacts()]);
    const count = (filter) => contacts.filter(filter).length;
    res.json({
      totals: {
        subscribed: count((c) => c.status === "subscribed"),
        pending: count((c) => c.status === "pending"),
        unsubscribed: count((c) => c.status === "unsubscribed"),
      },
      groups: groups.map((g) => ({
        ...g,
        subscribed: count((c) => c.status === "subscribed" && (c.groups || []).includes(g.id)),
        pending: count((c) => c.status === "pending" && (c.groups || []).includes(g.id)),
      })),
    });
  }));

  // Groups
  router.post("/groups", asyncRoute(async (req, res) => {
    const fields = cleanGroupFields(req.body);
    if (!fields.name) return res.status(400).json({ error: "Give the group a name." });
    res.status(201).json(await store.createGroup(fields));
  }));

  router.patch("/groups/:id", asyncRoute(async (req, res) => {
    const fields = cleanGroupFields(req.body);
    if (!fields.name) return res.status(400).json({ error: "Give the group a name." });
    const group = await store.updateGroup(req.params.id, fields);
    if (!group) return res.status(404).json({ error: "Group not found." });
    res.json(group);
  }));

  router.delete("/groups/:id", asyncRoute(async (req, res) => {
    await store.deleteGroup(req.params.id);
    res.status(204).end();
  }));

  // Contacts
  router.get("/contacts", asyncRoute(async (req, res) => {
    res.json(await store.listContacts());
  }));

  router.post("/contacts", asyncRoute(async (req, res) => {
    const { name, phone, groupIds, attest } = req.body || {};
    const e164 = normalizeUSPhone(phone);
    if (!e164) return res.status(400).json({ error: "Enter a valid US mobile number." });
    if (attest !== true) return res.status(400).json({ error: "Confirm this person agreed to get texts." });
    const groups = await validGroupIds(groupIds);
    if (groups.length === 0) return res.status(400).json({ error: "Pick at least one group." });

    const existing = await store.getContact(e164);
    if (existing && existing.status === "unsubscribed") {
      return res.status(409).json({ error: "This number opted out. They can rejoin by signing up on the website." });
    }
    const contact = await store.saveContact(e164, {
      name: String(name || "").trim().slice(0, 80) || (existing && existing.name) || "",
      groups: [...new Set([...((existing && existing.groups) || []), ...groups])],
      status: "subscribed",
      consent: { source: "admin", by: req.admin.email, text: ADMIN_ATTEST_TEXT, at: new Date().toISOString() },
    });
    res.status(existing ? 200 : 201).json(contact);
  }));

  router.patch("/contacts/:phone", asyncRoute(async (req, res) => {
    const existing = await store.getContact(req.params.phone);
    if (!existing) return res.status(404).json({ error: "Contact not found." });
    const patch = {};
    if (typeof req.body.name === "string") patch.name = req.body.name.trim().slice(0, 80);
    if (Array.isArray(req.body.groups)) patch.groups = await validGroupIds(req.body.groups);
    // Admins can take someone off the list, but only the person can opt back in.
    if (req.body.status === "unsubscribed") patch.status = "unsubscribed";
    res.json(await store.saveContact(existing.phone, patch));
  }));

  router.delete("/contacts/:phone", asyncRoute(async (req, res) => {
    await store.deleteContact(req.params.phone);
    res.status(204).end();
  }));

  router.post("/contacts/send-confirmations", asyncRoute(async (req, res) => {
    if (!sender.enabled) return res.status(409).json({ error: "Connect Twilio before sending confirmations." });
    const [contacts, groups] = await Promise.all([store.listContacts(), store.listGroups()]);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const due = contacts.filter(
      (c) => c.status === "pending" && (!c.confirmationSentAt || Date.parse(c.confirmationSentAt) < dayAgo)
    );
    let sent = 0;
    for (const c of due) {
      const names = groups.filter((g) => (c.groups || []).includes(g.id)).map((g) => g.name);
      try {
        await sender.send(c.phone, messages.confirm(names));
        await store.saveContact(c.phone, { confirmationSentAt: new Date().toISOString() });
        sent++;
      } catch (err) {
        console.error("confirmation failed", c.phone, err.message);
      }
    }
    res.json({ sent, skipped: contacts.filter((c) => c.status === "pending").length - sent });
  }));

  // Blasts
  router.post("/blasts/preview", asyncRoute(async (req, res) => {
    const groupIds = await validGroupIds(req.body && req.body.groupIds);
    res.json({ recipients: recipientsFor(await store.listContacts(), groupIds).length });
  }));

  router.post("/blasts", asyncRoute(async (req, res) => {
    const body = String((req.body && req.body.body) || "").trim();
    if (!body) return res.status(400).json({ error: "Write a message first." });
    if (body.length > MAX_BODY) return res.status(400).json({ error: `Keep it under ${MAX_BODY} characters.` });
    const groupIds = await validGroupIds(req.body.groupIds);
    if (groupIds.length === 0) return res.status(400).json({ error: "Pick at least one group." });

    const options = { store, sender, body, groupIds, addFooter: req.body.addFooter !== false, createdBy: req.admin.email };
    const blast = sender.enabled ? await sendBlast(options) : await prepareManualBlast(options);
    res.status(201).json(blast);
  }));

  router.post("/blasts/:id/sent", asyncRoute(async (req, res) => {
    const blast = await store.markManualSent(req.params.id, String(req.body.phone || ""), req.body.sent !== false);
    if (!blast) return res.status(404).json({ error: "That person isn't on this list." });
    res.json(blast);
  }));

  router.post("/blasts/test", asyncRoute(async (req, res) => {
    if (!sender.enabled) return res.status(409).json({ error: "Test sends need Twilio. In manual mode, text yourself from the list." });
    const e164 = normalizeUSPhone(req.body && req.body.phone);
    if (!e164) return res.status(400).json({ error: "Enter a valid US mobile number for the test." });
    const body = String((req.body && req.body.body) || "").trim();
    if (!body) return res.status(400).json({ error: "Write a message first." });
    const text = personalize(body, { name: req.admin.name });
    try {
      const { sid, status } = await sender.send(e164, text);
      res.json({ sid, status });
    } catch (err) {
      res.status(502).json({ error: `Twilio rejected the test: ${err.message}` });
    }
  }));

  router.get("/blasts", asyncRoute(async (req, res) => {
    res.json(await store.listBlasts(50));
  }));

  router.get("/blasts/:id", asyncRoute(async (req, res) => {
    const blast = await store.getBlast(req.params.id);
    if (!blast) return res.status(404).json({ error: "Blast not found." });
    res.json(blast);
  }));

  router.get("/inbox", asyncRoute(async (req, res) => {
    res.json(await store.listInbound(100));
  }));

  return router;
}

module.exports = { adminRoutes };
