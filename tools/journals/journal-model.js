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

const icsEscape = value => String(value).replace(/\\/g, "\\\\").replace(/\r\n|[\r\n]/g, "\\n").replace(/[;,]/g, "\\$&");
function foldLine(line) {
  const encoder = new TextEncoder();
  let current = "", size = 0;
  const parts = [];
  for (const char of line) {
    const length = encoder.encode(char).length;
    if (size + length > 75) { parts.push(current); current = " "; size = 1; }
    current += char;
    size += length;
  }
  return [...parts, current].join("\r\n");
}
export function calendar(calls, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qinglin Xun//Journal Explorer//EN", "CALSCALE:GREGORIAN"];
  for (const call of calls) {
    if (!/^\d{4}-\d\d-\d\d$/.test(call.deadline || "") || !/^[a-z0-9-]+$/.test(call.id)) continue;
    lines.push("BEGIN:VEVENT", "UID:" + call.id + "@ql-xun.github.io", "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + call.deadline.replace(/-/g, ""),
      "SUMMARY:" + icsEscape(call.title),
      "DESCRIPTION:" + icsEscape("Submission deadline. Confirm time and time zone on the official CFP."),
      ...(safeLink(call.url) ? ["URL:" + safeLink(call.url)] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
