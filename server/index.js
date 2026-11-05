const { loadConfig } = require("./config");
const { createApp } = require("./app");
const { createSender } = require("./sms");
const { createMemoryStore } = require("./store/memory");

// Starter groups so the sign-up form isn't empty on day one. Rename or delete in /admin.
const DEFAULT_GROUPS = [
  { id: "friday-nights", name: "Friday Nights", description: "Weekly session times and court updates.", public: true },
  { id: "events", name: "Events & Socials", description: "Collabs, parties and special events.", public: true },
];

async function main() {
  const config = loadConfig();
  const store =
    config.store === "firestore" ? require("./store/firestore").createFirestoreStore() : createMemoryStore();
  const sender = createSender(config);

  if ((await store.listGroups()).length === 0) {
    for (const { id, ...group } of DEFAULT_GROUPS) {
      // Another instance starting at the same moment may have created it already (code 6).
      await store.createGroup(group, id).catch((err) => {
        if (err.code !== 6) throw err;
      });
    }
  }

  createApp({ config, store, sender }).listen(config.port, () => {
    console.log(
      `BK Tennis Club on :${config.port} (store=${store.kind}, sms=${sender.enabled ? "twilio" : "manual"}, ` +
        `admins=${config.adminEmails.length}${config.devAdminEmail ? ", dev auth ON" : ""})`
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
