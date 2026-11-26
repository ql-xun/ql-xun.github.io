// Shared browser and test logic.
export function safeLink(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function cfpCheckLabel(value) {
  // Never substitute the visitor's clock or a metadata-only build time.
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function daysLeft(date, today) {
  if (![date, today].every(value => /^\d{4}-\d\d-\d\d$/.test(value || ""))) return null;
  const times = [date, today].map(value => Date.parse(value + "T00:00:00Z"));
  if (!times.every(Number.isFinite)) return null;
  return Math.round((times[0] - times[1]) / 86400000);
}

export function callStatus(call, today) {
  if (call.status === "closed") return "closed";
  if (call.listed === false) return "unknown";
  if (call.status === "ongoing") return "ongoing";
  const days = daysLeft(call.deadline, today);
  return days === null ? "unknown" : days < 0 ? "past" : "open";
}

// Older "new" events include imported baselines. Do not use those as posting dates.
const listingDateStart = "2026-11-25";

export function callListingDate(call) {
  const first = call.history?.find(event => event.kind === "new");
  const date = cfpCheckLabel(first?.at)?.slice(0, 10);
  return date && date >= listingDateStart ? date : null;
}

export function callTags(call, today) {
  const status = callStatus(call, today);
  if (!["open", "ongoing"].includes(status)) return [];
  const tags = [];
  const age = daysLeft(today, callListingDate(call));
  if (age !== null && age >= 0 && age <= 30) tags.push("new");
  const remaining = daysLeft(call.deadline, today);
  if (remaining !== null && remaining >= 0 && remaining <= 7) tags.push("due");
  const change = call.history?.findLast(event => event.kind === "deadline");
  if (change?.to === call.deadline && daysLeft(change.to, change.from) > 0) tags.push("extended");
  return tags;
}

const communities = [
  ["comsoc", ["commag", "ieee-network", "wcm", "jsac", "ton", "tccn", "tgcn", "tnse", "tnsm", "iotj"]],
  ["computer", ["tdsc", "taffc", "tetc"]],
  ["other", ["tsp", "jstsp", "tvt", "scis"]]
];
const otherSocieties = { tsp: "sps", jstsp: "sps", tvt: "vts", scis: "scp" };
const libraryComSoc = new Set([...communities[0][1], "tcom", "twc", "comst", "cl", "wcl", "oj-coms"]);
const libraryComputer = new Set([...communities[1][1], "tmc", "tpds", "tc", "tcc"]);
export const libraryCommunities = ["comsoc", "computer", "acm", "other"];
const ascendingSorts = new Set(["name", "jcr", "cas", "length"]);
const descendingSorts = new Set(["impact", "count"]);
export function defaultLibraryDirection(key) {
  return descendingSorts.has(key) ? "desc" : "asc";
}

export function communityId(value) {
  return communities.some(([id]) => id === value) ? value : "comsoc";
}

export function journalRoute(search) {
  const query = new URLSearchParams(search);
  const overview = query.get("overview") === "all";
  if (query.get("view") === "library") {
    const society = query.get("librarySociety");
    const key = query.get("sort");
    const order = query.get("order");
    const sort = ascendingSorts.has(key) || descendingSorts.has(key) ?
      { key, direction: ["asc", "desc"].includes(order) ? order : defaultLibraryDirection(key) } : null;
    return { view: "library", society: libraryCommunities.includes(society) ? society : "comsoc", overview, sort };
  }
  return { view: "tracker", society: communityId(query.get("society")), overview };
}

export function journalGrade(journal) {
  const grade = journal.ccf?.grade;
  return ["A", "B", "C"].includes(grade) ? grade : null;
}

export function jcrRange(jcr) {
  const quartiles = [...new Set(jcr?.categories?.map(item => item.quartile) || [])].sort();
  return quartiles.length > 1 ? quartiles[0] + "–" + quartiles.at(-1) : quartiles[0] ?? null;
}

function initialLength(journal) {
  const text = compactSubmissionLength(journal.details?.length?.initial?.en);
  // Keep page and word limits separate; never convert one to the other.
  const match = text?.match(/^[≤<]\s*([\d,]+)\s+(?:magazine\s+)?(pages?|words?)\b/i);
  return match ? [match[2].toLowerCase().startsWith("page") ? 0 : 1, Number(match[1].replaceAll(",", ""))] : null;
}

function libraryValue(journal, key, stats, countYear) {
  switch (key) {
    case "name": return journal.name;
    case "impact": return journal.impact_factor?.value ?? null;
    case "cas": return journal.rankings?.cas?.zone ?? null;
    case "jcr": {
      const range = jcrRange(journal.rankings?.jcr);
      return range ? [Number(range[1]), Number(range.at(-1))] : null;
    }
    case "length": return initialLength(journal);
    case "count": return annualCount(stats[journal.id], countYear);
    default: return null;
  }
}

function compareLibraryValues(a, b, { key, direction }) {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  const sign = direction === "desc" ? -1 : 1;
  if (key === "length") return a[0] - b[0] || sign * (a[1] - b[1]);
  if (key === "jcr") return sign * (a[0] - b[0] || a[1] - b[1]);
  if (key === "name") return sign * a.localeCompare(b, "en");
  return sign * (a - b);
}

export function groupLibrary(journals, sort = null, stats = {}, countYear) {
  const groups = new Map(libraryCommunities.map(id => [id, []]));
  const values = new Map();
  for (const journal of journals) {
    const id = libraryComSoc.has(journal.id) ? "comsoc" : libraryComputer.has(journal.id) ? "computer" :
      journal.publisher === "ACM" ? "acm" : "other";
    groups.get(id).push(journal);
    if (sort) values.set(journal.id, libraryValue(journal, sort.key, stats, countYear));
  }
  return [...groups].map(([id, entries]) => ({
    id,
    journals: entries.sort((a, b) => (sort ?
      compareLibraryValues(values.get(a.id), values.get(b.id), sort) :
      (journalGrade(a) || "Z").localeCompare(journalGrade(b) || "Z", "en")) ||
      a.abbreviation.localeCompare(b.abbreviation, "en"))
  }));
}

function editorAt(editor, today) {
  return editor?.next?.since && editor.next.since <= today ? editor.next : editor;
}

export function currentEditor(journal, today) {
  return editorAt(journal.editor_in_chief, today);
}

export function currentEditors(journal, today) {
  const editor = journal.editor_in_chief;
  return editor ? [currentEditor(journal, today), ...(editor.co_editors || []).map(member => editorAt(member, today))] : [];
}

// Month-only presentation; keep original precision for provenance and handovers.
export function editorMonth(value) {
  return /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value || "") ?
    value.slice(0, 4) + "-" + (value.slice(5, 7) || "01") : null;
}

export function compactSubmissionLength(text) {
  return text?.replace(/（双栏）/g, "").replace(/（双栏，/g, "（")
    .replace(/\s*\(double[- ]column\)/gi, "").replace(/\(double[- ]column[;,]\s*/gi, "(")
    .replace(/^(?:通常\s*|Typically\s+)/i, "")
    .replace(/（正文）|\s*\(main text\)/gi, "").trim();
}

export function annualCount(data, year) {
  const count = data?.counts?.[year];
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function annualSeries(journal, data, currentYear) {
  return Array.from({ length: 6 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { year, count: annualCount(data, year), partial: year === currentYear,
      predecessor: Boolean(journal.previous_issns?.some(entry => year <= entry.through)) };
  }).filter(row => !row.partial || row.count !== null);
}

export function groupCallsByCommunity(journals, calls, today) {
  const active = new Map();
  for (const call of calls) {
    if (!["open", "ongoing"].includes(callStatus(call, today))) continue;
    if (!active.has(call.journal_id)) active.set(call.journal_id, []);
    active.get(call.journal_id).push(call);
  }
  const byId = new Map(journals.map(item => [item.id, item]));
  const assigned = new Set(communities.flatMap(([, ids]) => ids));
  return communities.map(([id, ids]) => {
    const titles = ids.map(key => byId.get(key)).filter(Boolean);
    if (id === "other") {
      titles.push(...journals.filter(item => !assigned.has(item.id) && (item.cfp_url || active.has(item.id)))
        .sort((a, b) => a.name.localeCompare(b.name, "en")));
    }
    return { id, journals: titles.map(journal => ({
      journal,
      subgroup: id === "other" ? otherSocieties[journal.id] || "misc" : null,
      calls: (active.get(journal.id) || []).sort((a, b) =>
        (a.deadline || "9999-12-31").localeCompare(b.deadline || "9999-12-31") ||
        a.title.localeCompare(b.title, "en"))
    })) };
  }).filter(group => group.journals.length);
}
