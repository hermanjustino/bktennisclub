const express = require("express");
const twilio = require("twilio");
const { normalizeUSPhone } = require("../lib/phone");
const { classifyKeyword, messages } = require("../lib/sms-text");

// Twilio webhooks: replies to our number (inbound) and delivery receipts (status).
// Every request must carry a valid X-Twilio-Signature for our auth token.
function twilioRoutes({ config, store, sender }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));

  router.use((req, res, next) => {
    if (!sender.enabled) return res.status(404).end();
    const valid = twilio.validateRequest(
      config.twilio.authToken,
      req.get("x-twilio-signature") || "",
      config.publicBaseUrl + req.originalUrl,
      req.body || {}
    );
    if (!valid) return res.status(403).end();
    next();
  });

  router.post("/inbound", async (req, res, next) => {
    try {
      const from = normalizeUSPhone(req.body.From) || String(req.body.From || "");
      const body = String(req.body.Body || "");
      // OptOutType is set when Twilio's own opt-out handling already replied.
      const handledByTwilio = Boolean(req.body.OptOutType);
      const keyword = (req.body.OptOutType || "").toUpperCase() || classifyKeyword(body);
      const contact = await store.getContact(from);

      await store.addInbound({
        from,
        body: body.slice(0, 1600),
        keyword: keyword || null,
        contactName: (contact && contact.name) || null,
        receivedAt: new Date().toISOString(),
      });

      const reply = new twilio.twiml.MessagingResponse();
      const now = new Date().toISOString();
      if (keyword === "STOP" && contact) {
        await store.saveContact(from, { status: "unsubscribed", unsubscribedAt: now });
      } else if (keyword === "START" && contact) {
        await store.saveContact(from, { status: "subscribed", resubscribedAt: now });
      } else if (keyword === "HELP" && !handledByTwilio) {
        reply.message(messages.help());
      } else if (keyword === "YES" && contact && contact.status === "pending") {
        await store.saveContact(from, { status: "subscribed", confirmedAt: now });
        const groups = await store.listGroups();
        reply.message(messages.welcome(groups.filter((g) => (contact.groups || []).includes(g.id)).map((g) => g.name)));
      }
      res.type("text/xml").send(reply.toString());
    } catch (err) {
      next(err);
    }
  });

  router.post("/status", async (req, res, next) => {
    try {
      const { MessageSid, MessageStatus, ErrorCode } = req.body;
      if (MessageSid && MessageStatus) await store.applyMessageStatus(MessageSid, MessageStatus, ErrorCode || null);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { twilioRoutes };
