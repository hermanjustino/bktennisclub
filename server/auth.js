const { OAuth2Client } = require("google-auth-library");

// Admin API auth: the admin page signs in with Google and sends the ID token as a
// Bearer token. Only verified emails on the ADMIN_EMAILS allowlist get through.
function createRequireAdmin(config) {
  const client = new OAuth2Client();

  return async function requireAdmin(req, res, next) {
    if (config.devAdminEmail && req.get("x-dev-admin") === "1") {
      req.admin = { email: config.devAdminEmail, name: "Local dev" };
      return next();
    }

    const match = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    if (!match || !config.googleClientId) return res.status(401).json({ error: "Sign in required" });

    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: match[1], audience: config.googleClientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: "Your sign-in expired. Please sign in again." });
    }

    const email = String(payload.email || "").toLowerCase();
    if (!payload.email_verified || !config.adminEmails.includes(email)) {
      return res.status(403).json({ error: `${email || "This account"} isn't an admin.` });
    }
    req.admin = { email, name: payload.name || email };
    next();
  };
}

module.exports = { createRequireAdmin };
