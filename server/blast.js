const { personalize, STOP_FOOTER } = require("./lib/sms-text");

const CONCURRENCY = 10;

function recipientsFor(contacts, groupIds) {
  return contacts.filter(
    (c) => c.status === "subscribed" && (c.groups || []).some((g) => groupIds.includes(g))
  );
}

// Runs fn over items with at most `limit` in flight. Twilio queues messages on its
// side, so API calls return quickly; this just keeps us under its request rate.
async function eachLimited(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

async function sendBlast({ store, sender, body, groupIds, addFooter, createdBy }) {
  const [contacts, groups] = await Promise.all([store.listContacts(), store.listGroups()]);
  const recipients = recipientsFor(contacts, groupIds);
  const template = addFooter ? body + STOP_FOOTER : body;

  const blast = await store.createBlast({
    body: template,
    groupIds,
    groupNames: groups.filter((g) => groupIds.includes(g.id)).map((g) => g.name),
    createdBy,
    mode: "twilio",
    status: "sending",
    recipients: recipients.length,
    accepted: 0,
    rejected: 0,
    delivered: 0,
    failed: 0,
  });

  let accepted = 0;
  let rejected = 0;
  const errors = [];
  await eachLimited(recipients, CONCURRENCY, async (contact) => {
    try {
      const { sid, status } = await sender.send(contact.phone, personalize(template, contact));
      await store.saveMessage(sid, { blastId: blast.id, phone: contact.phone, status });
      accepted++;
    } catch (err) {
      rejected++;
      if (errors.length < 5) errors.push(`${contact.phone}: ${err.message}`);
      // 21610: the number replied STOP. Keep our records in line with Twilio's.
      if (err.code === 21610) await store.saveContact(contact.phone, { status: "unsubscribed" });
    }
  });

  const status = rejected === 0 ? "sent" : accepted === 0 ? "failed" : "partial";
  return store.updateBlast(blast.id, { status, accepted, rejected, errors, finishedAt: new Date().toISOString() });
}

// Manual mode: build the list of personalized texts for the admin to send from
// their own phone. sentTo tracks progress so they can stop and pick up later.
async function prepareManualBlast({ store, body, groupIds, addFooter, createdBy }) {
  const [contacts, groups] = await Promise.all([store.listContacts(), store.listGroups()]);
  const template = addFooter ? body + STOP_FOOTER : body;
  const list = recipientsFor(contacts, groupIds).map((c) => ({
    phone: c.phone,
    name: c.name || "",
    text: personalize(template, c),
  }));
  return store.createBlast({
    body: template,
    groupIds,
    groupNames: groups.filter((g) => groupIds.includes(g.id)).map((g) => g.name),
    createdBy,
    mode: "manual",
    status: list.length ? "in_progress" : "done",
    recipients: list.length,
    list,
    sentTo: [],
  });
}

module.exports = { sendBlast, prepareManualBlast, recipientsFor };
