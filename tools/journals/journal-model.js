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

export function communityId(value) {
  return communities.some(([id]) => id === value) ? value : "comsoc";
}

export function currentEditor(journal, today) {
  const editor = journal.editor_in_chief;
  return editor?.next?.since && editor.next.since <= today ? editor.next : editor;
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

export function filterJournals(entries, filters, stats, year) {
  const terms = (filters.query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const count = item => stats[item.id]?.counts?.[year] ?? -1;
  const grade = item => ["A", "B", "C", "not-listed", undefined].indexOf(item.ccf?.grade);
  return entries.filter(item =>
    (!filters.category || filters.category === item.category) &&
    (!filters.publisher || filters.publisher === item.publisher) &&
    (!filters.access || filters.access === (item.access || "unknown")) &&
    (!filters.grade || filters.grade === (item.ccf?.grade || "unknown")) &&
    terms.every(term => [item.abbreviation, item.name, item.publisher, item.issn, ...(item.tags || []), ...(item.aliases || [])].join(" ").toLowerCase().includes(term))
  ).sort((a, b) => (filters.sort === "count" ? count(b) - count(a)
    : filters.sort === "grade" ? grade(a) - grade(b) : 0) || a.abbreviation.localeCompare(b.abbreviation));
}

export function sanitizeNotes(value, allowed) {
  if (!value || value.version !== 1 || !value.items || typeof value.items !== "object" || Array.isArray(value.items)) {
    throw new Error("Invalid favorites export");
  }
  const items = Object.create(null);
  for (const [key, note] of Object.entries(value.items)) {
    if (allowed.has(key) && typeof note === "string") items[key] = note.slice(0, 4000);
  }
  return items;
}
