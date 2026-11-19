import test from "node:test";
import assert from "node:assert/strict";
import { calendar, callStatus, daysLeft, filterJournals, safeLink, sanitizeNotes } from "../tools/journals/journal-model.js";

const journals = [
  { id: "a", abbreviation: "TCOM", name: "Transactions on Communications", category: "communications", publisher: "IEEE", access: "hybrid", tags: ["MIMO"], ccf: { grade: "B" } },
  { id: "b", abbreviation: "TMC", name: "Transactions on Mobile Computing", category: "networking", publisher: "IEEE", tags: ["MIMO"], ccf: { grade: "A" } },
  { id: "c", abbreviation: "ComMag", name: "Communications Magazine", category: "magazine", publisher: "IEEE", ccf: { grade: "not-listed" } }
];

test("combines filters, uses actual unknown, and sorts zero before missing", () => {
  const stats = { a: { counts: { 2025: 0 } } };
  assert.deepEqual(filterJournals(journals, { query: "MIMO TCOM", publisher: "IEEE", access: "hybrid" }, stats, 2025).map(x => x.id), ["a"]);
  assert.deepEqual(filterJournals(journals, { grade: "C" }, stats, 2025), []);
  assert.equal(filterJournals(journals, { sort: "count" }, stats, 2025)[0].id, "a");
});

test("deadline states do not infer closure from missing time or listing", () => {
  assert.equal(daysLeft("2026-11-14", "2026-11-14"), 0);
  assert.equal(daysLeft(null, "2026-11-14"), null);
  assert.equal(callStatus({ status: "closed", deadline: "2027-01-01" }, "2026-11-14"), "closed");
  assert.equal(callStatus({ status: "dated", deadline: "2027-01-01", listed: false }, "2026-11-14"), "unknown");
  assert.equal(callStatus({ status: "dated", deadline: "2026-11-01" }, "2026-11-14"), "past");
});

test("notes allow only known IDs without interpreting text as HTML", () => {
  const raw = JSON.parse('{"version":1,"items":{"__proto__":"bad","j:a":"<b>note</b>","j:b":99}}');
  assert.equal(sanitizeNotes(raw, new Set(["j:a", "j:b"]))["j:a"], "<b>note</b>");
  assert.deepEqual(Object.keys(sanitizeNotes(raw, new Set(["j:a", "j:b"]))), ["j:a"]);
  assert.throws(() => sanitizeNotes({ version: 2 }, new Set()));
  assert.equal(safeLink("javascript:alert(1)"), null);
});

test("calendar uses an all-day date and escapes content", () => {
  const text = calendar([{ id: "a-123", deadline: "2026-11-21", title: "测试;Call\nNext, item", url: "https://example.org/cfp" }],
    new Date("2026-11-14T00:00:00Z"));
  assert.match(text, /DTSTART;VALUE=DATE:20261121/);
  assert.ok(text.includes("SUMMARY:测试\\;Call\\nNext\\, item"));
  assert.ok(text.endsWith("\r\n"));
  assert.ok(text.split("\r\n").every(line => Buffer.byteLength(line) <= 75));
});
