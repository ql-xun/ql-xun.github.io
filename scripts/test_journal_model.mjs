import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { annualCount, annualSeries, callStatus, cfpCheckLabel, communityId, compactSubmissionLength, currentEditor, currentEditors, daysLeft, editorMonth,
  groupCallsByCommunity, groupLibrary, jcrRange, journalGrade, journalRoute, safeLink } from "../tools/journals/journal-model.js";
import { bindTrendTrigger } from "../tools/journals/trend-trigger.js";

const registry = JSON.parse(readFileSync(new URL("../tools/journals/registry.json", import.meta.url), "utf8"));

test("journal page has no personal-home controls or branding", () => {
  const html = readFileSync(new URL("../tools/journals/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /languageToggle|journal-utilities|Qinglin Xun|荀清林|href="\/"/);
  assert.match(html, /<html lang="zh-CN" data-lang="zh" data-page="journals">/);
  assert.match(html, /<title>期刊观察<\/title>/);
  assert.match(html, /rel="icon" href="\.\/favicon\.svg(?:\?v=[\w-]+)?"/);
});

test("journal language defaults to Chinese in isolation and follows history; homepage toggle still works", () => {
  const source = readFileSync(new URL("../assets/js/site.js", import.meta.url), "utf8");
  function setup(page, search, toggle = null) {
    const root = { dataset: { page } };
    const document = { documentElement: root, getElementById: id => id === "languageToggle" ? toggle : null,
      querySelectorAll: () => [] };
    const events = new Map();
    let saved = "en";
    const writes = [];
    const window = { location: { search }, addEventListener: (event, fn) => events.set(event, fn),
      localStorage: { getItem: () => saved, setItem: (key, next) => { saved = next; writes.push([key, next]); } } };
    runInNewContext(source, { document, window, URLSearchParams, navigator: { language: "en" } });
    return { root, document, window, writes, events };
  }
  for (const [search, lang] of [["", "zh"], ["?view=library", "zh"], ["?lang=fr", "zh"], ["?lang=zh", "zh"], ["?lang=en", "en"]]) {
    const { root, document, window, events, writes } = setup("journals", search);
    assert.equal(root.dataset.lang, lang);
    assert.equal(document.title, lang === "zh" ? "期刊观察" : "Journal Explorer");
    window.location.search = "?lang=en&view=library";
    events.get("popstate")();
    assert.equal(root.lang, "en");
    window.location.search = "";
    events.get("popstate")();
    assert.equal(root.lang, "zh-CN");
    assert.deepEqual(writes, []);
  }
  let click;
  const toggle = { setAttribute() {}, addEventListener: (event, fn) => { if (event === "click") click = fn; } };
  const home = setup("home", "?lang=zh", toggle);
  assert.equal(home.document.title, "荀清林｜主页");
  assert.equal(toggle.textContent, "English");
  click();
  assert.equal(home.document.title, "Qinglin Xun | Homepage");
  assert.equal(toggle.textContent, "中文");
});

test("rank summaries use the JIF quartile range, not a best-only value; missing is null", () => {
  const byId = new Map(registry.map(journal => [journal.id, journal]));
  assert.equal(jcrRange(byId.get("tcom").rankings.jcr), "Q1");
  assert.equal(jcrRange(byId.get("wcl").rankings.jcr), "Q1–Q2");
  assert.equal(jcrRange(byId.get("taco").rankings.jcr), "Q2–Q3");
  assert.equal(jcrRange(byId.get("ton").rankings?.jcr), null);
  assert.equal(jcrRange({ categories: [{ quartile: "Q2" }], partial: true }), "Q2");
  assert.equal(byId.get("scis").rankings.cas.category.zh, "计算机科学");
  assert.equal(byId.get("scis").rankings.cas.zone, 1);
  assert.equal(registry.filter(row => row.rankings?.cas?.year === 2025).length, 32);
  assert.equal(byId.get("ton").rankings?.cas, undefined);
  assert.equal(byId.get("tcom").rankings.cas.zone, 2);
  assert.equal(byId.get("tsp").rankings.cas.category.zh, "工程技术");
  assert.equal(byId.get("tocs").rankings.cas.zone, 4);
  const snapshot = JSON.parse(readFileSync(new URL("../tools/journals/snapshot.json", import.meta.url), "utf8"));
  assert.deepEqual(snapshot.journals.map(row => [row.id, row.rankings]), registry.map(row => [row.id, row.rankings]));
});

test("SI timestamp comes from the saved check and always uses Beijing time", () => {
  assert.equal(cfpCheckLabel("2026-11-19T12:07:47Z"), "2026-11-19 20:07");
  assert.equal(cfpCheckLabel("2026-11-19T00:00:00+08:00"), "2026-11-19 00:00");
  for (const absent of [null, undefined, "", "2026-11-19", "2026-11-19T12:07:47", "invalid", 123]) {
    assert.equal(cfpCheckLabel(absent), null);
  }
});

test("chief display uses month precision without changing the source date", () => {
  assert.equal(editorMonth("2026"), "2026-01");
  assert.equal(editorMonth("2026-08"), "2026-08");
  assert.equal(editorMonth("2026-01-15"), "2026-01");
  assert.equal(editorMonth(null), null);
  assert.equal(editorMonth(""), null);
  const editor = { since: "2026" };
  editorMonth(editor.since);
  assert.equal(editor.since, "2026");
});

test("concise submission labels keep exceptional formats and strict inequalities", () => {
  const examples = [
    ["≤13 页（双栏）", "≤13 页"],
    ["<40 页（双栏，综述／教程）", "<40 页（综述／教程）"],
    ["≤5 页（双栏，短文）", "≤5 页（短文）"],
    ["通常 ≤16 页（双栏）", "≤16 页"],
    ["≤4,500 词（正文）", "≤4,500 词"],
    ["≤30 页（单栏，双倍行距）", "≤30 页（单栏，双倍行距）"],
    ["Typically ≤16 pages (double-column)", "≤16 pages"],
    ["Typically ≤16 pages (double column)", "≤16 pages"],
    ["<40 pages (double-column, survey/tutorial)", "<40 pages (survey/tutorial)"],
    ["≤5 pages (double column; letter)", "≤5 pages (letter)"],
    ["≤4,500 words (main text)", "≤4,500 words"]
  ];
  for (const [before, after] of examples) assert.equal(compactSubmissionLength(before), after);
  for (const journal of registry) {
    for (const limit of [journal.details?.length?.initial, journal.details?.length?.revised]) {
      if (!limit) continue;
      assert.doesNotMatch(compactSubmissionLength(limit.en), /double[- ]column/i);
      assert.doesNotMatch(compactSubmissionLength(limit.zh), /双栏/);
    }
  }
});

test("submission limits use current journal guides and distinguish absent caps from no cap", () => {
  const byId = new Map(registry.map(journal => [journal.id, journal]));
  for (const [id, pages] of Object.entries({ tmc: 18, tpds: 18, tc: 14, tcc: 18, tdsc: 18, taffc: 18, tetc: 16 })) {
    const length = byId.get(id).details.length;
    assert.equal(length.initial.zh, `≤${pages} 页`);
    assert.match(length.url, /^https:\/\/www\.computer\.org\/csdl\/journal\/.+\/write-for-us\/\d+$/);
    assert.equal(length.revised, undefined);
  }
  assert.match(byId.get("taco").details.length.initial.zh, /20.*不含参考文献/);
  assert.equal(byId.get("taco").details.length.initial.zh, "≤20 页（ACM 模板，不含参考文献）");
  assert.equal(byId.get("taco").details.length.initial.en, "≤20 pages (ACM template; excl. refs)");
  assert.match(byId.get("taco").details.length.revised.zh, /25.*含参考文献/);
  assert.match(byId.get("tosn").details.length.initial.zh, /无页数／字数上限/);
  assert.match(byId.get("jpdc").details.length.initial.zh, /16.*单栏 20/);
  for (const id of ["iotj", "tnsm", "tocs", "computer-networks", "computer-communications", "scis"]) {
    assert.equal(byId.get(id).details.length.initial, undefined);
    assert.equal(byId.get(id).details.length.revised, undefined);
    assert.equal(byId.get(id).details.length.checked_at, "2026-11-19");
  }
  assert.equal(journalGrade(byId.get("scis")), "A");
  assert.match(byId.get("scis").ccf.url, /^https:\/\/www\.ccf\.org\.cn\//);
});

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
