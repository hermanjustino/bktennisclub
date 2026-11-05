const crypto = require("node:crypto");

// In-memory store for local development and tests. Same interface as firestore.js.
const FINAL_STATUSES = ["delivered", "undelivered", "failed"];
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const newId = () => crypto.randomBytes(10).toString("hex");

function createMemoryStore() {
  const groups = new Map();
  const contacts = new Map();
  const blasts = new Map();
  const messages = new Map();
  const inbound = [];

  return {
    kind: "memory",

    async listGroups() {
      return [...groups.values()].map(clone).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async getGroup(id) {
      return clone(groups.get(id)) || null;
    },
    async createGroup(data, id) {
      if (id && groups.has(id)) throw Object.assign(new Error("Group already exists"), { code: 6 });
      const group = { ...data, id: id || newId(), createdAt: new Date().toISOString() };
      groups.set(group.id, group);
      return clone(group);
    },
    async updateGroup(id, patch) {
      if (!groups.has(id)) return null;
      groups.set(id, { ...groups.get(id), ...patch });
      return clone(groups.get(id));
    },
    async deleteGroup(id) {
      groups.delete(id);
      for (const c of contacts.values()) c.groups = (c.groups || []).filter((g) => g !== id);
    },

    async getContact(phone) {
      return clone(contacts.get(phone)) || null;
    },
    async saveContact(phone, patch) {
      const now = new Date().toISOString();
      const existing = contacts.get(phone);
      const next = { ...(existing || { phone, createdAt: now, groups: [] }), ...patch, phone, updatedAt: now };
      contacts.set(phone, next);
      return clone(next);
    },
    async listContacts() {
      return [...contacts.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async deleteContact(phone) {
      contacts.delete(phone);
    },

    async createBlast(data) {
      const blast = { ...data, id: newId(), createdAt: new Date().toISOString() };
      blasts.set(blast.id, blast);
      return clone(blast);
    },
    async updateBlast(id, patch) {
      blasts.set(id, { ...blasts.get(id), ...patch });
      return clone(blasts.get(id));
    },
    async getBlast(id) {
      return clone(blasts.get(id)) || null;
    },
    async listBlasts(limit = 50) {
      return [...blasts.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    // Manual blasts: tick a person off (or back on) the send list.
    async markManualSent(id, phone, sent) {
      const blast = blasts.get(id);
      if (!blast || blast.mode !== "manual" || !blast.list.some((r) => r.phone === phone)) return null;
      const sentTo = new Set(blast.sentTo || []);
      if (sent) sentTo.add(phone);
      else sentTo.delete(phone);
      blast.sentTo = [...sentTo];
      blast.status = sentTo.size >= blast.list.length ? "done" : "in_progress";
      return clone(blast);
    },

    async saveMessage(sid, data) {
      messages.set(sid, { ...data, sid });
    },
    // Records a delivery status update and bumps the blast's delivered/failed
    // counters the first time a message reaches a final state.
    async applyMessageStatus(sid, status, errorCode) {
      const message = messages.get(sid);
      if (!message) return;
      const wasFinal = FINAL_STATUSES.includes(message.status);
      message.status = status;
      if (errorCode) message.errorCode = errorCode;
      if (wasFinal || !FINAL_STATUSES.includes(status) || !message.blastId) return;
      const blast = blasts.get(message.blastId);
      if (!blast) return;
      if (status === "delivered") blast.delivered = (blast.delivered || 0) + 1;
      else blast.failed = (blast.failed || 0) + 1;
    },

    async addInbound(data) {
      inbound.unshift({ ...data, id: newId() });
    },
    async listInbound(limit = 100) {
      return inbound.slice(0, limit).map(clone);
    },
  };
}

module.exports = { createMemoryStore, FINAL_STATUSES };
