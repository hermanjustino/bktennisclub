const test = require("node:test");
const assert = require("node:assert/strict");
const twilio = require("twilio");
const { createApp } = require("../server/app");
const { createMemoryStore } = require("../server/store/memory");

const AUTH_TOKEN = "test-auth-token";
const PHONE = "+17185550123";

async function setup({ smsEnabled = true } = {}) {
  const config = {
    publicBaseUrl: "https://bktennisclub.test",
    googleClientId: "",
    adminEmails: [],
    devAdminEmail: "admin@test",
    twilio: { authToken: AUTH_TOKEN },
  };
  const store = createMemoryStore();
  const sent = [];
  let nextSid = 1;
  const sender = {
    enabled: smsEnabled,
    async send(to, body) {
      if (!smsEnabled) throw new Error("Twilio isn't configured");
      const sid = `SM${nextSid++}`;
      sent.push({ to, body, sid });
      return { sid, status: "queued" };
    },
  };
  const friday = await store.createGroup({ name: "Friday Nights", description: "Weekly", public: true });
  const secret = await store.createGroup({ name: "Coaches", description: "", public: false });

  const server = createApp({ config, store, sender }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const json = async (path, { method = "GET", body, admin } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (admin) headers["x-dev-admin"] = "1";
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  // Signs like Twilio does, against the public URL the server is configured with.
  const webhook = async (path, params, { signature } = {}) => {
    const url = config.publicBaseUrl + path;
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature || twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, params),
      },
      body: new URLSearchParams(params).toString(),
    });
    return { status: res.status, text: await res.text() };
  };

  return { store, sent, friday, secret, json, webhook, close: () => server.close() };
}

test("sign-up, YES confirmation, blast, delivery receipts and STOP", async (t) => {
  const app = await setup();
  t.after(app.close);

  const groups = await app.json("/api/groups");
  assert.deepEqual(groups.body.map((g) => g.name), ["Friday Nights"], "hidden groups stay off the form");

  const bad = await app.json("/api/signup", { method: "POST", body: { name: "Ann", phone: "123", groupIds: [app.friday.id], consent: true } });
  assert.equal(bad.status, 400);

  const noConsent = await app.json("/api/signup", { method: "POST", body: { name: "Ann", phone: PHONE, groupIds: [app.friday.id] } });
  assert.equal(noConsent.status, 400);

  const hiddenOnly = await app.json("/api/signup", { method: "POST", body: { name: "Ann", phone: PHONE, groupIds: [app.secret.id], consent: true } });
  assert.equal(hiddenOnly.status, 400, "can't join a hidden group from the public form");

  const signup = await app.json("/api/signup", {
    method: "POST",
    body: { name: "Ann Smith", phone: "(718) 555-0123", groupIds: [app.friday.id], consent: true },
  });
  assert.equal(signup.status, 200);
  assert.equal(signup.body.status, "pending");
  assert.equal(app.sent.length, 1);
  assert.match(app.sent[0].body, /Reply YES to confirm texts for Friday Nights/);
  const pending = await app.store.getContact(PHONE);
  assert.equal(pending.status, "pending");
  assert.equal(pending.consent.source, "web");

  // A pending contact isn't texted by blasts.
  const early = await app.json("/api/admin/blasts/preview", { method: "POST", body: { groupIds: [app.friday.id] }, admin: true });
  assert.equal(early.body.recipients, 0);

  const yes = await app.webhook("/webhooks/twilio/inbound", { From: PHONE, Body: "Yes" });
  assert.equal(yes.status, 200);
  assert.match(yes.text, /You're in!/);
  assert.equal((await app.store.getContact(PHONE)).status, "subscribed");

  const blast = await app.json("/api/admin/blasts", {
    method: "POST",
    body: { body: "Hey {first_name}, courts 3 & 4 at 7", groupIds: [app.friday.id], addFooter: true },
    admin: true,
  });
  assert.equal(blast.status, 201);
  assert.equal(blast.body.recipients, 1);
  assert.equal(blast.body.accepted, 1);
  const blastText = app.sent.at(-1);
  assert.equal(blastText.body, "Hey Ann, courts 3 & 4 at 7\nReply STOP to opt out");

  await app.webhook("/webhooks/twilio/status", { MessageSid: blastText.sid, MessageStatus: "delivered" });
  await app.webhook("/webhooks/twilio/status", { MessageSid: blastText.sid, MessageStatus: "delivered" });
  assert.equal((await app.store.getBlast(blast.body.id)).delivered, 1, "duplicate receipts count once");

  await app.webhook("/webhooks/twilio/inbound", { From: PHONE, Body: "STOP", OptOutType: "STOP" });
  assert.equal((await app.store.getContact(PHONE)).status, "unsubscribed");
  const after = await app.json("/api/admin/blasts/preview", { method: "POST", body: { groupIds: [app.friday.id] }, admin: true });
  assert.equal(after.body.recipients, 0);

  const inbox = await app.json("/api/admin/inbox", { admin: true });
  assert.deepEqual(inbox.body.map((m) => m.keyword), ["STOP", "YES"]);
});

test("webhooks reject bad signatures", async (t) => {
  const app = await setup();
  t.after(app.close);
  await app.store.saveContact(PHONE, { name: "Ann", status: "pending", groups: [app.friday.id] });
  const res = await app.webhook("/webhooks/twilio/inbound", { From: PHONE, Body: "YES" }, { signature: "forged" });
  assert.equal(res.status, 403);
  assert.equal((await app.store.getContact(PHONE)).status, "pending");
});

test("admin API requires sign-in", async (t) => {
  const app = await setup();
  t.after(app.close);
  assert.equal((await app.json("/api/admin/summary")).status, 401);
  assert.equal((await app.json("/api/admin/blasts", { method: "POST", body: { body: "hi", groupIds: [app.friday.id] } })).status, 401);
});

test("admin can add contacts only with consent, and can't re-add opt-outs", async (t) => {
  const app = await setup();
  t.after(app.close);
  const body = { name: "Ben", phone: "212-555-0199", groupIds: [app.secret.id] };
  assert.equal((await app.json("/api/admin/contacts", { method: "POST", body, admin: true })).status, 400);
  const added = await app.json("/api/admin/contacts", { method: "POST", body: { ...body, attest: true }, admin: true });
  assert.equal(added.status, 201);
  assert.equal(added.body.status, "subscribed");

  await app.json(`/api/admin/contacts/${encodeURIComponent("+12125550199")}`, { method: "PATCH", body: { status: "unsubscribed" }, admin: true });
  const again = await app.json("/api/admin/contacts", { method: "POST", body: { ...body, attest: true }, admin: true });
  assert.equal(again.status, 409);
});

test("deleting a group removes it from contacts", async (t) => {
  const app = await setup();
  t.after(app.close);
  await app.store.saveContact(PHONE, { name: "Ann", status: "subscribed", groups: [app.friday.id, app.secret.id] });
  await app.json(`/api/admin/groups/${app.secret.id}`, { method: "DELETE", admin: true });
  assert.deepEqual((await app.store.getContact(PHONE)).groups, [app.friday.id]);
});

test("manual mode: sign-ups join right away and blasts become a send list", async (t) => {
  const app = await setup({ smsEnabled: false });
  t.after(app.close);

  const signup = await app.json("/api/signup", {
    method: "POST",
    body: { name: "Ann Smith", phone: "718-555-0123", groupIds: [app.friday.id], consent: true },
  });
  assert.equal(signup.body.status, "subscribed");
  assert.equal(app.sent.length, 0, "nothing is texted automatically");
  await app.store.saveContact("+13475550188", { name: "Opted Out", status: "unsubscribed", groups: [app.friday.id] });

  const blast = await app.json("/api/admin/blasts", {
    method: "POST",
    body: { body: "Hi {first_name}! Courts at 7", groupIds: [app.friday.id], addFooter: true },
    admin: true,
  });
  assert.equal(blast.status, 201);
  assert.equal(blast.body.mode, "manual");
  assert.deepEqual(blast.body.list, [{ phone: PHONE, name: "Ann Smith", text: "Hi Ann! Courts at 7\nReply STOP to opt out" }]);
  assert.equal(blast.body.status, "in_progress");

  const marked = await app.json(`/api/admin/blasts/${blast.body.id}/sent`, { method: "POST", body: { phone: PHONE }, admin: true });
  assert.deepEqual(marked.body.sentTo, [PHONE]);
  assert.equal(marked.body.status, "done");

  const stranger = await app.json(`/api/admin/blasts/${blast.body.id}/sent`, { method: "POST", body: { phone: "+12125550100" }, admin: true });
  assert.equal(stranger.status, 404, "can only tick people on the list");

  const unmarked = await app.json(`/api/admin/blasts/${blast.body.id}/sent`, { method: "POST", body: { phone: PHONE, sent: false }, admin: true });
  assert.equal(unmarked.body.status, "in_progress");

  const reopened = await app.json(`/api/admin/blasts/${blast.body.id}`, { admin: true });
  assert.deepEqual(reopened.body.sentTo, []);

  const test = await app.json("/api/admin/blasts/test", { method: "POST", body: { phone: PHONE, body: "hi" }, admin: true });
  assert.equal(test.status, 409);
});

test("manual mode: webhooks are disabled", async (t) => {
  const app = await setup({ smsEnabled: false });
  t.after(app.close);
  const res = await app.webhook("/webhooks/twilio/inbound", { From: PHONE, Body: "YES" });
  assert.equal(res.status, 404);
});
