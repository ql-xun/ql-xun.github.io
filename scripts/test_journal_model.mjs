import test from "node:test";
import assert from "node:assert/strict";
import { callStatus, communityId, currentEditor, daysLeft, filterJournals, groupCallsByCommunity, safeLink, sanitizeNotes } from "../tools/journals/journal-model.js";

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

test("CFPs stay grouped by society and journal, with topics sorted by title", () => {
  const titles = ["tdsc", "tvt", "jsac", "commag", "new", "scis", "jstsp", "tsp", "tetc", "taffc", "ton"].map(id => ({ id, name: id }));
  const input = [
    { journal_id: "tdsc", title: "Earlier deadline", status: "dated", deadline: "2026-11-15" },
    { journal_id: "commag", title: "Z topic", status: "dated", deadline: "2026-11-16" },
    { journal_id: "commag", title: "A topic", status: "dated", deadline: "2026-12-20" },
    { journal_id: "commag", title: "Closed", status: "closed", deadline: "2026-12-20" },
    { journal_id: "commag", title: "Past", status: "dated", deadline: "2026-11-01" },
    { journal_id: "ton", title: "Old TNET topic", status: "dated", deadline: "2025-01-15" },
    { journal_id: "commag", title: "Missing from list", status: "dated", deadline: "2026-12-20", listed: false },
    { journal_id: "new", title: "New source", status: "ongoing" }
  ];
  const groups = groupCallsByCommunity(titles, input, "2026-11-14");
  assert.deepEqual(groups.map(group => group.id), ["comsoc", "computer", "other"]);
  assert.deepEqual(groups[0].journals.map(item => item.journal.id), ["commag", "jsac", "ton"]);
  assert.deepEqual(groups[0].journals[0].calls.map(item => item.title), ["A topic", "Z topic"]);
  assert.deepEqual(groups[0].journals[1].calls, []);
  assert.deepEqual(groups[0].journals[2].calls, []);
  assert.deepEqual(groups[1].journals.map(item => item.journal.id), ["tdsc", "taffc", "tetc"]);
  assert.deepEqual(groups[2].journals.map(item => [item.journal.id, item.subgroup]),
    [["tsp", "sps"], ["jstsp", "sps"], ["tvt", "vts"], ["scis", "scp"], ["new", "misc"]]);
});

test("society links only accept recognized groups and default to ComSoc", () => {
  assert.equal(communityId(null), "comsoc");
  assert.equal(communityId("<other>"), "comsoc");
  assert.equal(communityId("computer"), "computer");
  assert.equal(communityId("other"), "other");
});

test("TSP switches chief only on the effective handover date", () => {
  const journal = { editor_in_chief: {
    name: "Zhi Tian", since: "2024-01-01", next: { name: "Chandra R. Murthy", since: "2027-01-01" }
  }};
  assert.equal(currentEditor(journal, "2026-12-31").name, "Zhi Tian");
  assert.equal(currentEditor(journal, "2027-01-01").name, "Chandra R. Murthy");
  assert.equal(currentEditor({}, "2027-01-01"), undefined);
});
