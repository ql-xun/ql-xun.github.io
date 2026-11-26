import { annualCount, annualSeries, callListingDate, callTags, cfpCheckLabel, compactSubmissionLength, currentEditors, defaultLibraryDirection, editorMonth, groupCallsByCommunity, groupLibrary, jcrRange, journalGrade, journalRoute, libraryCommunities, safeLink } from "./journal-model.js?v=9";
import { bindTrendTrigger } from "./trend-trigger.js";

const app = document.querySelector("#journal-app");
const root = document.documentElement;
const t = (en, zh) => root.dataset.lang === "zh" ? zh : en;
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const year = Number(today.slice(0, 4));
const missing = "—";
let route = journalRoute(location.search);
let journals, stats, calls, snapshot;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter(item => item !== null && item !== undefined));
  return node;
}
const p = (text, cls) => el("p", { class: cls }, text);
function link(url, text) {
  const href = safeLink(url);
  return href && text ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text) : null;
}
const fmt = value => value === null ? missing : new Intl.NumberFormat(root.lang).format(value);
function rerender() {
  const key = document.activeElement?.getAttribute("data-focus");
  render();
  if (key) [...app.querySelectorAll("[data-focus]")].find(node => node.dataset.focus === key)?.focus({ preventScroll: true });
}
function table(headers, rows, label, style) {
  const cells = headers.map(header => typeof header === "string" ? el("th", { scope: "col" }, header) :
    el("th", { scope: "col", "aria-sort": header.sortDirection }, header.content));
  return el("div", { class: "journal-table-wrap", tabindex: 0, role: "region", "aria-label": label },
    el("table", { class: style ? "journal-table " + style : "journal-table", "aria-label": label },
      el("thead", {}, el("tr", {}, cells)),
      el("tbody", {}, rows.map(row => el("tr", {}, row.map((value, i) =>
        style && !i ? el("th", { scope: "row" }, value) : el("td", {}, value)))))));
}

function navigateJournal(url) {
  history.pushState(null, "", url);
  route = journalRoute(location.search);
  rerender();
}

function routeLink(label, view, society, focus) {
  const url = new URL(location.href);
  if (view === "library") url.searchParams.set("view", "library");
  else url.searchParams.delete("view");
  if (society) {
    url.searchParams.set(view === "library" ? "librarySociety" : "society", society);
    url.searchParams.delete("overview");
  }
  const current = route.view === view && (!society || (!route.overview && route.society === society));
  return el("a", { href: url.href, "aria-current": current ? "page" : null, "data-focus": focus,
    onclick: event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (current) return;
      navigateJournal(url);
    } }, label);
}

function overviewButton() {
  return el("button", { type: "button", class: "journal-overview", "aria-pressed": String(route.overview),
    "data-focus": "overview", onclick: () => {
      const url = new URL(location.href);
      if (route.overview) url.searchParams.delete("overview");
      else url.searchParams.set("overview", "all");
      navigateJournal(url);
    } }, t("Overview", "整体预览"));
}

const societyLabels = () => ({
  comsoc: t("IEEE Communications Society", "IEEE 通信学会"),
  computer: t("IEEE Computer Society", "IEEE 计算机学会"),
  acm: t("ACM", "ACM 计算机学会"),
  other: t("Other societies", "其他学会")
});

function societyNav(labels, ids) {
  return el("nav", { class: "cfp-societies", "aria-label": t("Societies", "学会导航") },
    ids.map(id => routeLink(labels[id], route.view, id, "society-" + id)));
}

function chiefLine(journal) {
  const editors = currentEditors(journal, today);
  // An empty array still renders both field labels with a dash.
  return (editors.length ? editors : [null]).map(editor => {
    const month = editorMonth(editor?.since);
    return el("p", { class: "cfp-chief journal-muted" },
      el("span", {}, t("Editor-in-Chief: ", "主编："), link(editor?.source, editor?.name) || editor?.name || missing),
      el("span", {}, t("Since: ", "上任："), link(editor?.since_source, month) || month || missing));
  });
}

function pageLimits(journal) {
  const detail = journal.details?.length;
  if (!detail?.initial && !detail?.revised) return missing;
  const stage = (label, value) => {
    const text = value && compactSubmissionLength(t(value.en, value.zh));
    return el("div", { class: "journal-limit" }, label ? el("span", {}, label) : null,
      link(detail.url, text) || text || missing);
  };
  return el("div", {}, stage(detail.revised ? t("Initial", "初投") : null, detail.initial),
    detail.revised ? stage(t("Revised", "修回"), detail.revised) : null);
}

function impactFactor(journal) {
  const impact = journal.impact_factor;
  if (!impact) return missing;
  const value = new Intl.NumberFormat(root.lang, { minimumFractionDigits: 1 }).format(impact.value);
  return el("span", { class: "journal-numeric" }, value);
}

// A shared panel floats outside the scrollable table, so overflow never clips it.
const trend = el("section", { class: "journal-trend", id: "journal-detail", hidden: true, "aria-labelledby": "journal-detail-title" });
app.after(trend);
let trendAnchor = null;
function closeTrend() {
  trendAnchor?.setAttribute("aria-expanded", "false");
  trendAnchor = null;
  trend.hidden = true;
}

function positionTrend() {
  if (!trendAnchor) return;
  const anchor = trendAnchor.getBoundingClientRect();
  const tableBounds = trendAnchor.closest(".journal-table-wrap").getBoundingClientRect();
  const { clientWidth: width, clientHeight: height } = root;
  if (anchor.bottom < 0 || anchor.top > height ||
      anchor.right <= Math.max(0, tableBounds.left) || anchor.left >= Math.min(width, tableBounds.right)) {
    // Keyboard focus can reach a cell before the table scrolls it into view.
    trend.hidden = true;
    trendAnchor.setAttribute("aria-expanded", "false");
    return;
  }
  trend.hidden = false;
  trendAnchor.setAttribute("aria-expanded", "true");
  const margin = 8;
  const { offsetWidth, offsetHeight } = trend;
  const clamp = (value, max) => Math.max(margin, Math.min(value, max - margin));
  const below = anchor.bottom + margin;
  const above = anchor.top - margin - offsetHeight;
  const top = below + offsetHeight <= height - margin || above < margin ? below : above;
  trend.style.left = clamp(anchor.right - offsetWidth, width - offsetWidth) + "px";
  trend.style.top = clamp(top, height - offsetHeight) + "px";
}

function showDetail(anchor, content) {
  if (anchor === trendAnchor) {
    positionTrend();
    return;
  }
  closeTrend();
  trend.replaceChildren(...content());
  trendAnchor = anchor;
  positionTrend();
}

function trendContent(journal) {
  const data = stats[journal.id];
  const series = annualSeries(journal, data, year);
  const max = Math.max(1, ...series.map(row => row.count ?? 0));
  return [
    el("h3", { id: "journal-detail-title" }, journal.abbreviation + t(" · OpenAlex counts", " · OpenAlex 收录量")),
    el("ul", { class: "journal-trend-series", role: "list", style: "--years:" + series.length }, series.map(row =>
      el("li", { class: row.partial ? "journal-trend-partial" : null },
        el("div", { class: "journal-trend-track" },
          el("div", { class: "journal-trend-fill", style: "--share:" + (row.count ?? 0) / max },
            el("span", { class: "journal-trend-value" }, fmt(row.count)))),
        el("span", { class: "journal-trend-year" }, String(row.year) + (row.predecessor ? "*" : ""),
          row.partial ? el("small", {}, t("YTD", "年内")) : null)))),
    data?.checked_at ? p(t("Checked ", "数据核查 ") + data.checked_at.slice(0, 10), "journal-muted") : null,
    series.some(row => row.predecessor) ?
      p(t("* IEEE/ACM predecessor title", "* 对应旧刊名 IEEE/ACM Transactions on Networking"), "journal-muted") : null
  ].filter(Boolean);
}

function bindDetail(anchor, content) {
  bindTrendTrigger(anchor, {
    open: () => showDetail(anchor, content),
    close: closeTrend,
    isOpen: () => trendAnchor === anchor
  });
  return anchor;
}

function countCell(journal) {
  const count = annualCount(stats[journal.id], year - 1);
  if (count === null) return missing;
  const value = fmt(count);
  const anchor = el("button", { type: "button", class: "journal-numeric journal-count",
    "aria-label": t(journal.abbreviation + ": " + value + " works in " + (year - 1) + ", view annual counts",
      journal.abbreviation + "，" + (year - 1) + " 年收录 " + value + " 篇，查看年度收录量"),
    "aria-controls": trend.id, "aria-expanded": "false", "data-focus": "count-" + journal.id }, value);
  return bindDetail(anchor, () => trendContent(journal));
}

function casZone(value) {
  return t("Q" + value, value + " 区");
}

function rankingContent(journal) {
  const { jcr, cas } = journal.rankings;
  const detail = (label, rows, data) => el("div", { class: "journal-rank-detail" },
    el("h4", {}, label),
    rows.length ? el("dl", {}, rows.flatMap(([category, rank]) => [el("dt", {}, category), el("dd", {}, rank)])) : missing,
    data?.partial ? p(t("Range covers only the verified categories.", "范围仅涵盖已核实的学科。"), "journal-muted") : null);
  return [
    el("h3", { id: "journal-detail-title" }, journal.abbreviation + t(" · Rankings", " · 分区")),
    detail(t("JCR · JIF year 2025 (2026 release)", "JCR · 2025 指标年（2026 年发布）"),
      jcr?.categories.map(({ category, quartile }) => [category, quartile]) || [], jcr),
    detail(t("CAS · 2025 edition (major category)", "中科院 · 2025 版（大类）"),
      cas ? [[t(cas.category.en, cas.category.zh), casZone(cas.zone)]] : [], cas)
  ];
}

function rankingCell(journal) {
  const jcr = jcrRange(journal.rankings?.jcr);
  const cas = journal.rankings?.cas;
  const casLabel = t("CAS", "中科院");
  const summary = (label, value) => el("span", { class: "journal-rank-line" },
    label + t(": ", "："), el("span", { class: value ? "journal-rank-value" : "journal-muted" }, value || missing));
  const rows = [summary("JCR", jcr), summary(casLabel, cas ? casZone(cas.zone) : null)];
  if (!jcr && !cas) return el("div", { class: "journal-rank" }, rows);
  return bindDetail(el("button", { type: "button", class: "journal-count journal-rank",
    "aria-label": t(journal.abbreviation + " rankings: ", journal.abbreviation + " 分区：") +
      rows.map(row => row.textContent).join(t(", ", "，")),
    "aria-controls": trend.id, "aria-expanded": "false", "data-focus": "ranking-" + journal.id }, rows),
  () => rankingContent(journal));
}

function librarySortButton(key, label, groupId, description = label) {
  const active = (route.sort?.key || "ccf") === key;
  const direction = route.sort?.direction;
  const mark = active ? key === "ccf" ? "↓" : direction === "asc" ? "↑" : "↓" : key === "ccf" ? null : "↕";
  const hint = key === "ccf" ? t("Restore default CCF order", "恢复 CCF 默认顺序") :
    t("Sort by: ", "按此项排序：") + description;
  return el("button", { type: "button", class: "library-sort-button", title: hint,
    "aria-label": active && key !== "ccf" ?
      hint + (direction === "asc" ? t(", ascending", "，升序") : t(", descending", "，降序")) : hint,
    "aria-pressed": String(active), "data-focus": "sort-" + groupId + "-" + key,
    onclick: () => {
      const url = new URL(location.href);
      if (key === "ccf") {
        if (active) return;
        url.searchParams.delete("sort");
        url.searchParams.delete("order");
      } else {
        url.searchParams.set("sort", key);
        url.searchParams.set("order", active ? direction === "asc" ? "desc" : "asc" : defaultLibraryDirection(key));
      }
      navigateJournal(url);
    } }, label, mark ? el("span", { class: "library-sort-mark", "aria-hidden": "true" }, mark) : null);
}

function libraryGroup(group, label) {
  const direction = route.sort?.direction === "desc" ? "descending" : "ascending";
  const sort = (key, title, description) => ({
    content: librarySortButton(key, title, group.id, description),
    sortDirection: route.sort?.key === key ? key === "length" ? "other" : direction : null
  });
  const headings = [
    sort("name", t("Journal", "期刊")),
    { content: librarySortButton("ccf", "CCF", group.id), sortDirection: route.sort ? null : "ascending" },
    sort("impact", t("Impact factor", "IF因子")),
    { content: el("div", { class: "library-rank-sorts" }, t("Rankings", "分区"),
      el("div", {}, librarySortButton("jcr", "JCR", group.id), librarySortButton("cas", "CAS", group.id, t("CAS", "中科院大类")))),
      sortDirection: ["jcr", "cas"].includes(route.sort?.key) ? direction : null },
    sort("length", t("Length limit", "投稿页数"),
      t("initial limit; pages before words", "初投篇幅；页数和字数分开")),
    sort("count", t((year - 1) + " indexed works", (year - 1) + " 年收录量"))
  ];
  const rows = group.journals.map(item => {
    const title = item.name + " (" + item.abbreviation + ")";
    const grade = journalGrade(item);
    return [
      el("div", { class: "library-journal", "data-journal": item.id },
        el("span", { class: "journal-name" }, link(item.url, title) || title), chiefLine(item)),
      grade ? "CCF-" + grade : missing,
      impactFactor(item),
      rankingCell(item),
      pageLimits(item),
      countCell(item)
    ];
  });
  return el("section", { class: "library-group", "data-society": group.id },
    el("h2", { class: "library-heading" }, label), table(headings, rows, label, "library-table"));
}

function library() {
  const labels = societyLabels();
  const groups = groupLibrary(journals, route.sort, stats, year - 1)
    .filter(group => route.overview || group.id === route.society);
  return el("section", { class: "journal-library", "aria-label": t("Journal library", "期刊资料库") },
    societyNav(labels, libraryCommunities),
    groups.map(group => libraryGroup(group, labels[group.id])));
}

function cfpTopic(call) {
  const first = callListingDate(call);
  const tags = {
    new: ["New", t("First detected in the last 30 days", "最近 30 天首次监测到")],
    due: ["Due soon", t("Deadline within 7 days", "距离截稿不超过 7 天")],
    extended: ["Extended", t("Submission deadline was extended", "投稿截止日期已延期")]
  };
  return el("div", { class: "cfp-topic" },
    link(call.url, call.title) || call.title,
    ...callTags(call, today).map(key => el("span", { class: "cfp-tag cfp-tag-" + key, title: tags[key][1] }, tags[key][0])),
    el("div", { class: "cfp-listing journal-muted",
      title: t("First detected by the tracker, not necessarily the publisher announcement date", "首次监测到征稿的日期，不一定是出版社公告日期") },
      t("First seen: ", "发布时间："), first ? el("time", { datetime: first }, first) : missing));
}

function cfpJournal({ journal, calls: entries }, heading) {
  const label = journal.name + " (" + journal.abbreviation + ")";
  const name = link(journal.cfp_url || journal.url, label) || label;
  return el("section", { class: "cfp-journal", "data-journal": journal.id },
    el("header", { class: "cfp-journal-heading" },
      el(heading, { class: "cfp-title" }, name),
      el("div", { class: "cfp-editor-list" }, chiefLine(journal))),
    entries.length ? table([t("Topic", "特刊主题"), t("Submission deadline", "投稿截止日期"), t("Guest editors", "客座编辑")],
      entries.map(call => [cfpTopic(call),
        call.deadline ? el("time", { datetime: call.deadline, class: "journal-numeric" }, call.deadline) : missing,
        (call.editors || []).map(name => name.trim().replace(/[\s,，;；]+$/, "")).filter(Boolean).join(", ") || missing]), label) :
      p(t("No SI", "暂无SI"), "journal-muted cfp-empty"));
}
function tracker() {
  const labels = societyLabels();
  const subdivisions = {
    sps: t("IEEE Signal Processing Society", "IEEE 信号处理学会"),
    vts: t("IEEE Vehicular Technology Society", "IEEE 车辆技术学会"),
    scp: t("Science China Press", "中国科学杂志社"),
    misc: t("Other publications", "其他期刊")
  };
  const groups = groupCallsByCommunity(journals, calls, today)
    .filter(group => route.overview || group.id === route.society);
  const nav = societyNav(labels, ["comsoc", "computer", "other"]);
  const checked = cfpCheckLabel(snapshot.cfp_checked_at);
  return el("section", { class: "cfp-directory", "aria-label": t("Special issues by society", "按学会浏览特刊") },
    nav,
    p([t("Last checked: ", "更新："), checked ?
      el("time", { datetime: snapshot.cfp_checked_at }, checked) : missing,
      t(" (Beijing time)", "（北京时间）")], "cfp-updated journal-muted"),
    groups.map(group => el("section", { class: "cfp-community", "data-society": group.id, "aria-labelledby": "cfp-heading-" + group.id },
      el("h2", { id: "cfp-heading-" + group.id }, labels[group.id]),
      group.id === "other" ? Object.entries(subdivisions).map(([id, label]) => {
        const items = group.journals.filter(item => item.subgroup === id);
        return items.length ? el("section", { class: "cfp-subgroup" }, el("h3", {}, label),
          items.map(item => cfpJournal(item, "h4"))) : null;
      }) : group.journals.map(item => cfpJournal(item, "h3")))));
}
function render() {
  closeTrend();
  if (!journals) {
    app.replaceChildren(p(t("Journal data could not load. Reload the page to try again.", "未能加载期刊数据，请刷新页面重试。"), "journal-state"));
    return;
  }
  app.replaceChildren(el("nav", { class: "journal-tabs", "aria-label": t("Journal Explorer views", "期刊观察功能") },
    routeLink(t("Journal library", "期刊资料库"), "library", null, "view-library"),
    routeLink(t("Special issues", "特刊追踪"), "tracker", null, "view-tracker"),
    overviewButton()),
    route.view === "library" ? library() : tracker());
}
async function start() {
  try {
    const response = await fetch("./snapshot.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Snapshot unavailable");
    snapshot = await response.json();
    if (snapshot.version !== 1 || !Array.isArray(snapshot.journals) || !snapshot.journals.length) throw new Error("Invalid snapshot");
    journals = snapshot.journals;
    stats = snapshot.stats || {};
    calls = Object.values(snapshot.calls || {});
    render();
  } catch { journals = null; render(); }
  new MutationObserver(rerender).observe(root, { attributes: true, attributeFilter: ["data-lang"] });
}
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && trendAnchor) closeTrend();
});
document.addEventListener("pointerdown", event => {
  if (trendAnchor && !trendAnchor.contains(event.target)) closeTrend();
});
window.addEventListener("scroll", positionTrend, { capture: true, passive: true });
window.addEventListener("resize", positionTrend);
window.addEventListener("popstate", () => {
  route = journalRoute(location.search);
  render();
});
start();
