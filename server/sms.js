const twilio = require("twilio");

// Sends texts through a Twilio Messaging Service. Without Twilio credentials the
// site runs in manual mode: admins send each text from their own phone, and
// nothing calls send().
function createSender(config) {
  const statusCallback = config.publicBaseUrl.startsWith("https://")
    ? `${config.publicBaseUrl}/webhooks/twilio/status`
    : undefined;

  if (!config.smsEnabled) {
    return {
      enabled: false,
      async send() {
        throw new Error("Twilio isn't configured");
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
