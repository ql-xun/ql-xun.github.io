// Shared browser and test logic.
export function safeLink(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
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

const communities = [
  ["comsoc", ["commag", "ieee-network", "wcm", "jsac", "ton", "tccn", "tgcn", "tnse", "tnsm", "iotj"]],
  ["computer", ["tdsc", "taffc", "tetc"]],
  ["other", ["tsp", "jstsp", "tvt", "scis"]]
];
const otherSocieties = { tsp: "sps", jstsp: "sps", tvt: "vts", scis: "scp" };
const libraryComSoc = new Set([...communities[0][1], "tcom", "twc", "comst", "cl", "wcl", "oj-coms"]);
const libraryComputer = new Set([...communities[1][1], "tmc", "tpds", "tc", "tcc"]);
export const libraryCommunities = ["comsoc", "computer", "acm", "other"];

export function communityId(value) {
  return communities.some(([id]) => id === value) ? value : "comsoc";
}

export function journalRoute(search) {
  const query = new URLSearchParams(search);
  if (query.get("view") === "library") {
    const society = query.get("librarySociety");
    return { view: "library", society: libraryCommunities.includes(society) ? society : "comsoc" };
  }
  return { view: "tracker", society: communityId(query.get("society")) };
}

export function journalGrade(journal) {
  const grade = journal.ccf?.grade;
  return ["A", "B", "C"].includes(grade) ? grade : null;
}

export function groupLibrary(journals) {
  const groups = new Map(libraryCommunities.map(id => [id, []]));
  for (const journal of journals) {
    const id = libraryComSoc.has(journal.id) ? "comsoc" : libraryComputer.has(journal.id) ? "computer" :
      journal.publisher === "ACM" ? "acm" : "other";
    groups.get(id).push(journal);
  }
  return [...groups].map(([id, entries]) => ({
    id,
    journals: entries.sort((a, b) => (journalGrade(a) || "Z").localeCompare(journalGrade(b) || "Z", "en") ||
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
      calls: (active.get(journal.id) || []).sort((a, b) => a.title.localeCompare(b.title, "en"))
    })) };
  }).filter(group => group.journals.length);
}
