const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUSPhone } = require("../server/lib/phone");
const { countSegments, classifyKeyword, personalize } = require("../server/lib/sms-text");

test("normalizeUSPhone accepts common US formats", () => {
  assert.equal(normalizeUSPhone("(718) 555-0123"), "+17185550123");
  assert.equal(normalizeUSPhone("1-718-555-0123"), "+17185550123");
  assert.equal(normalizeUSPhone("+1 718.555.0123"), "+17185550123");
});

test("normalizeUSPhone rejects invalid numbers", () => {
  assert.equal(normalizeUSPhone("555-0123"), null);
  assert.equal(normalizeUSPhone("(118) 555-0123"), null); // area code can't start with 1
  assert.equal(normalizeUSPhone("+44 20 7946 0958"), null);
  assert.equal(normalizeUSPhone(undefined), null);
});

test("countSegments handles GSM-7 and Unicode limits", () => {
  assert.deepEqual(countSegments("a".repeat(160)), { encoding: "GSM-7", length: 160, segments: 1 });
  assert.equal(countSegments("a".repeat(161)).segments, 2);
  assert.equal(countSegments("{}".repeat(40)).length, 160); // extended chars count double
  const emoji = countSegments("See you tonight 🎾");
  assert.equal(emoji.encoding, "Unicode");
  assert.equal(countSegments("🎾".repeat(36)).segments, 2); // 72 UTF-16 units
});

test("classifyKeyword recognizes reply keywords", () => {
  assert.equal(classifyKeyword(" stop "), "STOP");
  assert.equal(classifyKeyword("Yes!"), "YES");
  assert.equal(classifyKeyword("unstop"), "START");
  assert.equal(classifyKeyword("help"), "HELP");
  assert.equal(classifyKeyword("yes see you there"), null);
});

test("personalize fills names with a fallback", () => {
  assert.equal(personalize("Hi {first_name}", { name: "Serena Williams" }), "Hi Serena");
  assert.equal(personalize("Hi {FIRST_NAME}", { name: "" }), "Hi there");
});
