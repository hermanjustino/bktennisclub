// All runtime settings come from environment variables (set on the Cloud Run service).
const env = process.env;
const onCloudRun = Boolean(env.K_SERVICE);
const port = Number(env.PORT) || 8080;

const list = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function loadConfig() {
  const twilio = {
    accountSid: env.TWILIO_ACCOUNT_SID || "",
    authToken: env.TWILIO_AUTH_TOKEN || "",
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || "",
  };
  return {
    port,
    onCloudRun,
    clubName: "BK Tennis Club",
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, ""),
    // Firebase web config for the admin's email-link sign-in. These values are public
    // (they ship to the browser); access is controlled by ADMIN_EMAILS.
    firebase: env.FIREBASE_PROJECT_ID
      ? {
          apiKey: env.FIREBASE_API_KEY || "",
          authDomain: env.FIREBASE_AUTH_DOMAIN || `${env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
          projectId: env.FIREBASE_PROJECT_ID,
          appId: env.FIREBASE_APP_ID || "",
        }
      : null,
    adminEmails: list(env.ADMIN_EMAILS),
    // Local-only shortcut that skips sign-in. Never honoured on Cloud Run.
    devAdminEmail: onCloudRun ? "" : (env.DEV_ADMIN_EMAIL || "").toLowerCase(),
    store: env.STORE || (onCloudRun ? "firestore" : "memory"),
    twilio,
    smsEnabled: Boolean(twilio.accountSid && twilio.authToken && twilio.messagingServiceSid),
  };
}

module.exports = { loadConfig };
