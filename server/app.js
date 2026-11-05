const path = require("node:path");
const express = require("express");
const { createRequireAdmin } = require("./auth");
const { publicRoutes } = require("./routes/public");
const { adminRoutes } = require("./routes/admin");
const { twilioRoutes } = require("./routes/twilio");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function createApp({ config, store, sender }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true); // Cloud Run sits behind Google's front end

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    next();
  });

  app.use("/webhooks/twilio", twilioRoutes({ config, store, sender }));

  app.use("/api", express.json({ limit: "32kb" }));
  app.use("/api", publicRoutes({ config, store, sender }));
  app.use("/api/admin", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api/admin", adminRoutes({ store, sender, requireAdmin: createRequireAdmin(config) }));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  // The admin page shares the segment counter with the server.
  app.get("/admin/sms-text.js", (req, res) => res.sendFile(path.join(__dirname, "lib", "sms-text.js")));
  app.get("/admin", (req, res, next) => (req.path.endsWith("/") ? next() : res.redirect(301, "/admin/")));

  app.use(
    express.static(PUBLIC_DIR, {
      extensions: ["html"],
      maxAge: "1h",
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) res.set("Cache-Control", "no-cache");
      },
    })
  );
  app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html")));

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return app;
}

module.exports = { createApp };
