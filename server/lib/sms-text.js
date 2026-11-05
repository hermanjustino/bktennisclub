// SMS text helpers: segment counting, reply keywords, personalization and the
// fixed messages the club sends. Shared with the admin page via /admin/sms-text.js.

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

// How many SMS segments a message costs. GSM-7 fits 160 chars (153 per part when
// split); anything outside GSM-7 (emoji, curly quotes) drops to 70 (67 per part).
function countSegments(text) {
  let gsmLength = 0;
  let isGsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      isGsm = false;
      break;
    }
  }
  if (isGsm) {
    return { encoding: "GSM-7", length: gsmLength, segments: gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153) };
  }
  const length = text.length; // UTF-16 code units, which is what UCS-2 counts
  return { encoding: "Unicode", length, segments: length <= 70 ? 1 : Math.ceil(length / 67) };
}

const KEYWORDS = {
  STOP: ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"],
  START: ["START", "UNSTOP"],
  HELP: ["HELP", "INFO"],
  YES: ["YES", "Y", "YEA", "YEAH", "CONFIRM", "JOIN"],
};

function classifyKeyword(body) {
  const word = String(body || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  for (const [keyword, words] of Object.entries(KEYWORDS)) {
    if (words.includes(word)) return keyword;
  }
  return null;
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

// Supports {first_name} and {name}; falls back to "there" so "Hi {first_name}" still reads.
function personalize(template, contact) {
  const first = firstName(contact && contact.name) || "there";
  const full = String((contact && contact.name) || "").trim() || "there";
  return template.replace(/\{first_name\}/gi, first).replace(/\{name\}/gi, full);
}

const STOP_FOOTER = "\nReply STOP to opt out";

function joinNames(names) {
  if (names.length <= 1) return names[0] || "club updates";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

const messages = {
  confirm: (groupNames) =>
    `BK Tennis Club: Reply YES to confirm texts for ${joinNames(groupNames)}. ` +
    "Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
  welcome: (groupNames) =>
    `BK Tennis Club: You're in! We'll text you about ${joinNames(groupNames)}. Reply STOP anytime to opt out.`,
  help: () =>
    "BK Tennis Club: Club session & event updates. For help, DM @bktennisclub on Instagram " +
    "or visit bktennisclub.com. Msg & data rates may apply. Reply STOP to opt out.",
};

const api = { countSegments, classifyKeyword, personalize, firstName, STOP_FOOTER, messages };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else globalThis.SmsText = api;
