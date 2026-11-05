const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { FINAL_STATUSES } = require("./memory");

// Firestore-backed store. Collections:
//   groups/{id}        name, description, public, createdAt
//   contacts/{e164}    phone, name, groups[], status, consent, timestamps
//   blasts/{id}        body, groupIds, counts, createdBy, createdAt
//   messages/{sid}     blastId, phone, status, errorCode  (for delivery callbacks)
//   inbound/{id}       from, body, keyword, receivedAt
// Club-sized data, so listing is done in full and filtered in code (no composite indexes).
function createFirestoreStore() {
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const now = () => new Date().toISOString();
  const data = (doc) => (doc.exists ? { ...doc.data(), id: doc.id } : null);

  return {
    kind: "firestore",

    async listGroups() {
      const snap = await db.collection("groups").orderBy("createdAt").get();
      return snap.docs.map(data);
    },
    async getGroup(id) {
      return data(await db.collection("groups").doc(id).get());
    },
    // `id` is only passed for the starter groups; create() fails if it already exists.
    async createGroup(fields, id) {
      const ref = id ? db.collection("groups").doc(id) : db.collection("groups").doc();
      const group = { ...fields, createdAt: now() };
      await ref.create(group);
      return { ...group, id: ref.id };
    },
    async updateGroup(id, patch) {
      const ref = db.collection("groups").doc(id);
      if (!(await ref.get()).exists) return null;
      await ref.update(patch);
      return data(await ref.get());
    },
    async deleteGroup(id) {
      const members = await db.collection("contacts").where("groups", "array-contains", id).get();
      const writer = db.bulkWriter();
      members.docs.forEach((doc) => writer.update(doc.ref, { groups: FieldValue.arrayRemove(id) }));
      writer.delete(db.collection("groups").doc(id));
      await writer.close();
    },

    async getContact(phone) {
      const contact = data(await db.collection("contacts").doc(phone).get());
      if (contact) delete contact.id;
      return contact;
    },
    async saveContact(phone, patch) {
      const ref = db.collection("contacts").doc(phone);
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const ts = now();
        const next = { ...(doc.exists ? doc.data() : { phone, createdAt: ts, groups: [] }), ...patch, phone, updatedAt: ts };
        tx.set(ref, next);
        return next;
      });
    },
    async listContacts() {
      const snap = await db.collection("contacts").orderBy("createdAt", "desc").get();
      return snap.docs.map((doc) => doc.data());
    },
    async deleteContact(phone) {
      await db.collection("contacts").doc(phone).delete();
    },

    async createBlast(fields) {
      const ref = db.collection("blasts").doc();
      const blast = { ...fields, createdAt: now() };
      await ref.set(blast);
      return { ...blast, id: ref.id };
    },
    async updateBlast(id, patch) {
      const ref = db.collection("blasts").doc(id);
      await ref.update(patch);
      return data(await ref.get());
    },
    async getBlast(id) {
      return data(await db.collection("blasts").doc(id).get());
    },
    async listBlasts(limit = 50) {
      const snap = await db.collection("blasts").orderBy("createdAt", "desc").limit(limit).get();
      return snap.docs.map(data);
    },

    // Manual blasts: tick a person off (or back on) the send list.
    async markManualSent(id, phone, sent) {
      const ref = db.collection("blasts").doc(id);
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const blast = doc.exists ? doc.data() : null;
        if (!blast || blast.mode !== "manual" || !blast.list.some((r) => r.phone === phone)) return null;
        const sentTo = new Set(blast.sentTo || []);
        if (sent) sentTo.add(phone);
        else sentTo.delete(phone);
        const patch = { sentTo: [...sentTo], status: sentTo.size >= blast.list.length ? "done" : "in_progress" };
        tx.update(ref, patch);
        return { ...blast, ...patch, id };
      });
    },

    async saveMessage(sid, fields) {
      await db.collection("messages").doc(sid).set({ ...fields, sid });
    },
    async applyMessageStatus(sid, status, errorCode) {
      const ref = db.collection("messages").doc(sid);
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        if (!doc.exists) return;
        const message = doc.data();
        const wasFinal = FINAL_STATUSES.includes(message.status);
        tx.update(ref, { status, ...(errorCode ? { errorCode } : {}) });
        if (wasFinal || !FINAL_STATUSES.includes(status) || !message.blastId) return;
        const field = status === "delivered" ? "delivered" : "failed";
        tx.update(db.collection("blasts").doc(message.blastId), { [field]: FieldValue.increment(1) });
      });
    },

    async addInbound(fields) {
      await db.collection("inbound").add(fields);
    },
    async listInbound(limit = 100) {
      const snap = await db.collection("inbound").orderBy("receivedAt", "desc").limit(limit).get();
      return snap.docs.map(data);
    },
  };
}

module.exports = { createFirestoreStore };
