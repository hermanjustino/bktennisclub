const crypto = require("node:crypto");
const twilio = require("twilio");

// Sends texts through a Twilio Messaging Service. Without Twilio credentials the
// sender runs in simulated mode: nothing leaves the server, messages are logged.
function createSender(config) {
  const statusCallback = config.publicBaseUrl.startsWith("https://")
    ? `${config.publicBaseUrl}/webhooks/twilio/status`
    : undefined;

  if (!config.smsEnabled) {
    return {
      enabled: false,
      async send(to, body) {
        console.log(`[sms:simulated] to=${to} ${JSON.stringify(body)}`);
        return { sid: `SIM${crypto.randomBytes(12).toString("hex")}`, status: "simulated" };
      },
    };
  }

  const client = twilio(config.twilio.accountSid, config.twilio.authToken);
  return {
    enabled: true,
    async send(to, body) {
      const message = await client.messages.create({
        to,
        body,
        messagingServiceSid: config.twilio.messagingServiceSid,
        statusCallback,
      });
      return { sid: message.sid, status: message.status };
    },
  };
}

module.exports = { createSender };
