const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

// Admin API auth: the admin page signs in with a Firebase email link and sends the
// Firebase ID token as a Bearer token. Only verified emails on the ADMIN_EMAILS
// allowlist get through.
function createRequireAdmin(config) {
  let auth = null;
  const firebaseAuth = () => {
    if (!auth) auth = getAuth(getApps()[0] || initializeApp({ projectId: config.firebase.projectId }));
    return auth;
  };

  return async function requireAdmin(req, res, next) {
    if (config.devAdminEmail && req.get("x-dev-admin") === "1") {
      req.admin = { email: config.devAdminEmail, name: "Local dev" };
      return next();
    }

    const match = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    if (!match || !config.firebase) return res.status(401).json({ error: "Sign in required" });

    let token;
    try {
      token = await firebaseAuth().verifyIdToken(match[1]);
    } catch {
      return res.status(401).json({ error: "Your sign-in expired. Please sign in again." });
    }

    const email = String(token.email || "").toLowerCase();
    if (!token.email_verified || !config.adminEmails.includes(email)) {
      return res.status(403).json({ error: `${email || "This account"} isn't an admin.` });
    }
    req.admin = { email, name: token.name || email };
    next();
  };
}

module.exports = { createRequireAdmin };
