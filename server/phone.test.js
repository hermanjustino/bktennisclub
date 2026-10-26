import { test } from "node:test";
import assert from "node:assert/strict";
import { toE164 } from "./phone.js";

test("normalizes common formats", () => {
  assert.equal(toE164("(718) 555-0123"), "+17185550123");
  assert.equal(toE164("718.555.0123"), "+17185550123");
  assert.equal(toE164("+1 718 555 0123"), "+17185550123");
  assert.equal(toE164("17185550123"), "+17185550123");
});

test("rejects invalid numbers", () => {
  assert.equal(toE164("555-0123"), null);
  assert.equal(toE164("+44 20 7946 0958"), null);
  assert.equal(toE164(""), null);
  assert.equal(toE164(undefined), null);
});
