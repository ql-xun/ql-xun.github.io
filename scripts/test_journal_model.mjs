import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { annualCount, annualSeries, callStatus, communityId, currentEditor, currentEditors, daysLeft,
  groupCallsByCommunity, groupLibrary, journalGrade, journalRoute, safeLink } from "../tools/journals/journal-model.js";
import { bindTrendTrigger } from "../tools/journals/trend-trigger.js";

const registry = JSON.parse(readFileSync(new URL("../tools/journals/registry.json", import.meta.url), "utf8"));

test("library groups contain all 33 existing titles exactly once and sort by rank", () => {
  const groups = groupLibrary(registry);
  assert.deepEqual(groups.map(({ id, journals }) => [id, journals.length]),
    [["comsoc", 16], ["computer", 7], ["acm", 3], ["other", 7]]);
  const ids = groups.flatMap(group => group.journals.map(item => item.id));
  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(ids.sort(), registry.map(item => item.id).sort());
  assert.deepEqual(groups[2].journals.map(item => item.id), ["taco", "tocs", "tosn"]);
  for (const group of groups) {
    const grades = group.journals.map(item => journalGrade(item) || "Z");
    assert.deepEqual(grades, [...grades].sort());
  }
  assert.equal(journalGrade({ ccf: { grade: "not-listed" } }), null);
  assert.equal(journalGrade({}), null);
});

test("library and tracker selections are independent; old tracker URLs still open", () => {
  assert.deepEqual(journalRoute("?lang=zh&society=computer"), { view: "tracker", society: "computer" });
  assert.deepEqual(journalRoute("?view=library&librarySociety=acm&society=computer&lang=en"), { view: "library", society: "acm" });
  assert.deepEqual(journalRoute("?view=library&society=other"), { view: "library", society: "comsoc" });
  assert.deepEqual(journalRoute("?view=favorites&society=acm"), { view: "tracker", society: "comsoc" });
  assert.deepEqual(journalRoute("?view=library&librarySociety=invalid"), { view: "library", society: "comsoc" });
});

test("chart series preserves zero, distinguishes missing, and marks YTD and predecessor data", () => {
  const journal = { previous_issns: [{ through: 2024 }] };
  const data = { counts: { 2021: 10, 2022: 0, 2023: null, 2024: "21", 2025: 20, 2026: 7 } };
  const series = annualSeries(journal, data, 2026);
  assert.deepEqual(series.map(item => item.count), [10, 0, null, null, 20, 7]);
  assert.deepEqual(series.map(item => item.year), [2021, 2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(series.map(item => item.predecessor), [true, true, true, true, false, false]);
  assert.equal(series.at(-1).partial, true);
  assert.equal(annualSeries(journal, { counts: {} }, 2026).length, 5);
  assert.equal(annualSeries(journal, { counts: { 2026: 0 } }, 2026).at(-1).count, 0);
  assert.equal(annualCount(null, 2025), null);
});

test("trend trigger handles mouse, keyboard and touch independently", () => {
  const control = new EventTarget();
  control.matches = selector => selector === ":focus-visible";
  let visible = false;
  bindTrendTrigger(control, { open: () => { visible = true; }, close: () => { visible = false; }, isOpen: () => visible });
  const dispatch = (type, data = {}) => control.dispatchEvent(Object.assign(new Event(type), data));
  dispatch("pointerenter", { pointerType: "mouse" });
  assert.equal(visible, true);
  dispatch("pointerleave", { pointerType: "mouse" });
  assert.equal(visible, false);
  dispatch("focus");
  assert.equal(visible, true);
  dispatch("blur");
  assert.equal(visible, false);
  dispatch("pointerenter", { pointerType: "touch" });
  dispatch("pointerdown", { pointerType: "touch" });
  dispatch("focus");
  assert.equal(visible, false);
  dispatch("click", { detail: 1 }); // A browser may emit a synthesized MouseEvent.
  assert.equal(visible, true);
  dispatch("pointerleave", { pointerType: "touch" });
  assert.equal(visible, true);
  dispatch("pointerdown", { pointerType: "touch" });
  dispatch("click", { detail: 1, pointerType: "touch" });
  assert.equal(visible, false);
});

test("deadline states do not infer closure from missing time or listing", () => {
  assert.equal(daysLeft("2026-11-14", "2026-11-14"), 0);
  assert.equal(daysLeft(null, "2026-11-14"), null);
  assert.equal(callStatus({ status: "closed", deadline: "2027-01-01" }, "2026-11-14"), "closed");
  assert.equal(callStatus({ status: "dated", deadline: "2027-01-01", listed: false }, "2026-11-14"), "unknown");
  assert.equal(callStatus({ status: "dated", deadline: "2026-11-01" }, "2026-11-14"), "past");
});

test("source links accept only HTTPS without embedded credentials", () => {
  assert.equal(safeLink("https://example.org"), "https://example.org/");
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("https://user:password@example.org"), null);
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

test("co-editors retain independent appointment dates and future terms", () => {
  const journal = { editor_in_chief: { name: "Editor A", since: "2019", co_editors: [
    { name: "Editor B", since: "2020", next: { name: "Editor C", since: "2027-01-01" } }
  ] } };
  assert.deepEqual(currentEditors(journal, "2026-12-31").map(({name, since}) => [name, since]), [["Editor A", "2019"], ["Editor B", "2020"]]);
  assert.deepEqual(currentEditors(journal, "2027-01-01").map(({name, since}) => [name, since]), [["Editor A", "2019"], ["Editor C", "2027-01-01"]]);
  assert.deepEqual(currentEditors({}, "2026-11-16"), []);
});
