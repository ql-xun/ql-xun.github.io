import { communityId, currentEditor, filterJournals, groupCallsByCommunity, safeLink, sanitizeNotes } from "./journal-model.js?v=3";

const app = document.querySelector("#journal-app");
const meta = document.querySelector("#journal-meta");
const root = document.documentElement;
const localKey = "qlx-journal-favorites-v1";
const t = (en, zh) => root.dataset.lang === "zh" ? zh : en;
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const year = Number(today.slice(0, 4));
const years = Array.from({ length: 6 }, (_, n) => year - 5 + n);
const missing = "—";
const categories = () => ({
  communications: t("Communications & wireless", "通信与无线"),
  networking: t("Networks & IoT", "网络与物联网"),
  systems: t("Signal processing & systems", "信号处理与计算机系统"),
  magazine: "Magazine"
});
const access = () => ({
  hybrid: t("Hybrid", "混合出版"), open: t("Open access", "开放获取"),
  subscription: t("Subscription", "订阅"), unknown: missing
});
const fields = () => [
  ["scope", t("Scope", "研究范围")], ["article_types", t("Article types", "论文类型")],
  ["length", t("Length limits", "篇幅限制")], ["review_model", t("Peer review", "审稿方式")],
  ["apc", t("APC", "开放获取费用")], ["overlength", t("Overlength fees", "超页费")],
  ["first_decision", t("Time to first decision", "首轮决定时间")],
  ["acceptance", t("Acceptance rate", "录用率")],
  ["official_volume", t("Publisher annual volume", "出版社年发文量")]
];
const societyFromUrl = () => communityId(new URLSearchParams(location.search).get("society"));
let society = societyFromUrl();
let journals, stats, calls, byId, callById, allowed, snapshot;
let notes = Object.create(null), tab = "tracker", detail = null;
let filters = { query: "", sort: "grade" };
const selected = new Set();
let statusText = "";
let storageWorks = true;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter(item => item !== null && item !== undefined));
  return node;
}
const p = (text, cls) => el("p", { class: cls }, text);
function link(url, text) {
  const href = safeLink(url);
  return href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, text) : null;
}
function button(text, fn, attrs = {}) { return el("button", { type: "button", onclick: fn, ...attrs }, text); }
const fmt = value => Number.isInteger(value) ? new Intl.NumberFormat(root.lang).format(value) : missing;
function rank(journal) {
  const grade = journal.ccf?.grade;
  return grade === "not-listed" ? t("Not listed", "未收录") : grade ? "CCF-" + grade : missing;
}
function dateNote(value) { return value ? t("Checked: ", "核查：") + value.slice(0, 10) : ""; }
const noteExists = key => Object.hasOwn(notes, key);
function persist() {
  try { localStorage.setItem(localKey, JSON.stringify({ version: 1, items: notes })); }
  catch { storageWorks = false; }
}
function rerender() {
  const key = document.activeElement?.getAttribute("data-focus");
  render();
  if (key) [...app.querySelectorAll("[data-focus]")].find(node => node.dataset.focus === key)?.focus({ preventScroll: true });
}
function favorite(key) {
  const saved = noteExists(key);
  return button(saved ? t("Saved", "已收藏") : t("Save", "收藏"), () => {
    if (saved) {
      if (notes[key] && !window.confirm(t("Remove this favorite and its note?", "移除此收藏及其备注？"))) return;
      delete notes[key];
    } else notes[key] = "";
    persist(); rerender();
  }, { "aria-pressed": String(saved), "data-focus": "save-" + key });
}
function table(headers, rows, label) {
  const cells = headers.map(title => el("th", { scope: "col" }, title));
  return el("div", { class: "journal-table-wrap", tabindex: 0, role: "region", "aria-label": label },
    el("table", { class: "journal-table", "aria-label": label }, el("thead", {}, el("tr", {}, cells)),
      el("tbody", {}, rows.map(row => el("tr", {}, row.map(value => el("td", {}, value)))))));
}
function select(label, options, initial, onChange) {
  const control = el("select", { onchange: event => onChange(event.target.value) },
    Object.entries(options).map(([value, name]) => el("option", { value }, name)));
  control.value = initial || "";
  return el("label", {}, label, control);
}
function search(label, initial, onInput) {
  return el("label", { class: "journal-filter-search" }, label, el("input", {
    type: "search", value: initial || "", oninput: event => onInput(event.target.value)
  }));
}
function compareButton(item) {
  const added = selected.has(item.id);
  return button(added ? t("Selected", "已选择") : t("Compare", "加入对比"), () => {
    if (added) selected.delete(item.id);
    else if (selected.size < 4) selected.add(item.id);
    rerender();
  }, { "aria-pressed": String(added), disabled: !added && selected.size >= 4, "data-focus": "compare-" + item.id });
}
function journalDetail(item) {
  const section = el("section", { class: "journal-drawer", id: "journal-detail" },
    el("h2", { tabindex: -1 }, item.name),
    p([item.issn && "ISSN " + item.issn, item.issn_l && "ISSN-L " + item.issn_l, item.publisher, categories()[item.category], dateNote(item.checked_at)].filter(Boolean).join(" · "), "journal-muted"),
    el("p", { class: "journal-links" }, link(item.url, t("Journal homepage", "期刊主页")),
      link(item.guidelines, t("Author guidelines", "作者指南")), link(item.submission, t("Submit a paper", "投稿入口")),
      link(item.cfp_url, t("Official calls", "官方 CFP")), link(item.identity_url, t("ISSN source", "ISSN 来源")),
      link(item.access_url, t("Open access source", "开放获取来源"))),
    item.aliases?.length ? p(t("Also listed as: ", "曾用名或别名：") + item.aliases.join(" / "), "journal-muted") : null,
    el("p", {}, rank(item), item.ccf ? [" · " + (item.ccf.category ? item.ccf.category + " · " : ""), link(item.ccf.url, item.ccf.version)] : []),
    p(t("Research tags: ", "方向标签：") + (item.tags || []).join(" · ")),
    el("dl", { class: "journal-fields" }, fields().flatMap(([key, title]) => {
      const field = item.details?.[key];
      return [el("dt", {}, title), el("dd", {}, metric(field))];
    })),
    el("h2", {}, t("OpenAlex indexed works", "OpenAlex 收录量")),
    chart(item, Math.max(1, ...years.map(y => stats[item.id]?.counts?.[y] ?? 0))), statSource(item),
    el("p", { class: "journal-actions" }, favorite("j:" + item.id), compareButton(item),
      button(t("Close details", "关闭详情"), () => {
        detail = null; render();
        app.querySelector('[data-focus="detail-' + item.id + '"]')?.focus({ preventScroll: true });
      })));
  return section;
}
function metric(field) {
  if (!field) return missing;
  return el("span", {}, field.value, " ", link(field.url, t("Source", "来源")),
    el("small", { class: "journal-sub journal-muted" }, [field.year, dateNote(field.checked_at)].filter(Boolean).join(" · ")));
}
function statSource(item) {
  const data = stats[item.id];
  if (!data?.checked_at) return null;
  return el("p", { class: "journal-muted" }, dateNote(data.checked_at),
    data.openalex_id ? [" · ", link("https://openalex.org/" + data.openalex_id, "OpenAlex")] : [],
    item.previous_issns?.length ? el("span", { class: "journal-sub" },
      t("Earlier years use the predecessor ISSN; the change in title is marked.", "早期年份按前身 ISSN 统计；更名处已标记。")) : null);
}
function chart(item, max) {
  return el("div", { class: "journal-chart" }, years.flatMap(y => {
    const value = stats[item.id]?.counts?.[y];
    const previous = item.previous_issns?.some(entry => y <= entry.through);
    const yearLabel = String(y) + (previous ? "*" : "") + (y === year ? t(" YTD", " 年内") : "");
    return [
      el("span", {}, yearLabel),
      el("div", { class: "journal-bar" + (y === year ? " journal-bar--partial" : ""), "aria-hidden": "true" },
        typeof value === "number" ? el("span", { style: "width:" + Math.max(0, Math.min(100, value * 100 / max)) + "%" }) : null),
      el("span", {}, fmt(value))
    ];
  }));
}
function library() {
  const wrap = el("section");
  const results = el("div");
  function draw() {
    const items = filterJournals(journals, filters, stats, year - 1);
    const rows = items.map(item => [
      el("div", {}, button(item.abbreviation, () => {
        detail = item.id; render(); app.querySelector("#journal-detail h2")?.focus();
      }, { class: "journal-name", "data-focus": "detail-" + item.id }),
      el("span", { class: "journal-sub journal-muted" }, item.name)),
      categories()[item.category], item.publisher,
      item.ccf ? link(item.ccf.url, rank(item)) || rank(item) : rank(item),
      access()[item.access || "unknown"] || missing,
      el("span", { class: "journal-numeric" }, fmt(stats[item.id]?.counts?.[year - 1])),
      el("div", { class: "journal-actions" }, favorite("j:" + item.id), compareButton(item))
    ]);
    results.replaceChildren(el("p", { role: "status", class: "journal-muted journal-result" },
      t(items.length + " of " + journals.length + " journals", journals.length + " 本中显示 " + items.length + " 本")),
      rows.length ? table([t("Journal", "期刊"), t("Area", "方向"), t("Publisher", "出版方"), "CCF",
        t("Access", "开放获取"), (year - 1) + t(" OpenAlex count", " 年收录量"), t("Actions", "操作")], rows, t("Journal library", "期刊资料库"))
        : p(t("No journal matches. Try fewer filters.", "没有符合条件的期刊，试试减少筛选条件。"), "journal-state"));
  }
  const change = key => value => { filters[key] = value; draw(); };
  const all = t("All", "全部");
  const publishers = Object.fromEntries([...new Set(journals.map(item => item.publisher))].sort().map(name => [name, name]));
  wrap.append(el("div", { class: "journal-filters" },
    search(t("Search by name, acronym, or topic", "搜索名称、简称、研究主题"), filters.query, change("query")),
    select(t("Area", "方向"), { "": all, ...categories() }, filters.category, change("category")),
    select(t("Publisher", "出版方"), { "": all, ...publishers }, filters.publisher, change("publisher")),
    select("CCF", { "": all, A: "A", B: "B", C: "C", "not-listed": t("Not listed", "未收录"), unknown: missing }, filters.grade, change("grade")),
    select(t("Access", "开放获取"), { "": all, ...access() }, filters.access, change("access")),
    select(t("Sort by", "排序"), { grade: "CCF", alpha: t("Acronym", "简称"), count: (year - 1) + t(" count", " 年收录量") }, filters.sort, change("sort"))),
    detail && byId.has(detail) ? journalDetail(byId.get(detail)) : el("span"), results);
  draw();
  return wrap;
}
function chiefLine(journal) {
  const editor = currentEditor(journal, today);
  return el("p", { class: "cfp-chief journal-muted" },
    el("span", {}, t("Editor-in-Chief: ", "主编："), link(editor?.source, editor?.name) || editor?.name || missing),
    el("span", {}, t("Since: ", "上任："), link(editor?.since_source, editor?.since) || editor?.since || missing));
}
function cfpJournal({ journal, calls: entries }, heading) {
  const label = journal.name + " (" + journal.abbreviation + ")";
  const name = link(journal.cfp_url || journal.url, label) || label;
  return el("section", { class: "cfp-journal", "data-journal": journal.id },
    el(heading, { class: "cfp-title" }, name), chiefLine(journal),
    entries.length ? table([t("Topic", "特刊主题"), t("Submission deadline", "投稿截止日期"), t("Guest editors", "客座编辑")],
      entries.map(call => [link(call.url, call.title) || call.title,
        call.deadline ? el("time", { datetime: call.deadline, class: "journal-numeric" }, call.deadline) : missing,
        (call.editors || []).map(name => name.trim().replace(/[\s,，;；]+$/, "")).filter(Boolean).join(", ") || missing]), label) :
      p(t("No SI", "暂无SI"), "journal-muted cfp-empty"));
}
function tracker() {
  const labels = {
    comsoc: t("IEEE Communications Society", "IEEE 通信学会"),
    computer: t("IEEE Computer Society", "IEEE 计算机学会"),
    other: t("Other societies", "其他学会")
  };
  const subdivisions = {
    sps: t("IEEE Signal Processing Society", "IEEE 信号处理学会"),
    vts: t("IEEE Vehicular Technology Society", "IEEE 车辆技术学会"),
    scp: t("Science China Press", "中国科学杂志社"),
    misc: t("Other publications", "其他期刊")
  };
  const group = groupCallsByCommunity(journals, calls, today).find(group => group.id === society);
  const nav = el("nav", { class: "cfp-societies", "aria-label": t("Societies", "学会导航") },
    Object.entries(labels).map(([id, label]) => {
      const url = new URL(location.href);
      url.searchParams.set("society", id);
      url.searchParams.set("lang", root.dataset.lang);
      return el("a", { href: url.href, "aria-current": society === id ? "page" : null,
        "data-focus": "society-" + id, onclick: event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (society === id) return;
          society = id;
          history.pushState(null, "", url);
          rerender();
        } }, label);
    }));
  return el("section", { class: "cfp-directory", "aria-label": t("Special issues by society", "按学会浏览特刊") },
    nav,
    group ? el("section", { class: "cfp-community", "data-society": group.id, "aria-labelledby": "cfp-community-heading" },
      el("h2", { id: "cfp-community-heading" }, labels[group.id]),
      group.id === "other" ? Object.entries(subdivisions).map(([id, label]) => {
        const items = group.journals.filter(item => item.subgroup === id);
        return items.length ? el("section", { class: "cfp-subgroup" }, el("h3", {}, label),
          items.map(item => cfpJournal(item, "h4"))) : null;
      }) : group.journals.map(item => cfpJournal(item, "h3"))) : null);
}
function comparison() {
  const items = [...selected].map(id => byId.get(id)).filter(Boolean);
  const selectList = el("details", { open: items.length < 2 || document.activeElement?.dataset.focus?.startsWith("compare-check-") }, el("summary", {}, t("Choose 2–4 journals", "选择 2–4 本期刊")),
    el("div", { class: "journal-filters" }, journals.map(item => el("label", {},
      el("span", {}, el("input", { type: "checkbox", checked: selected.has(item.id), disabled: !selected.has(item.id) && selected.size >= 4,
        "data-focus": "compare-check-" + item.id, onchange: event => { if (event.target.checked) selected.add(item.id); else selected.delete(item.id); rerender(); } }), " " + item.abbreviation)))));
  const wrap = el("section", {}, selectList);
  if (items.length < 2) {
    wrap.append(p(t("Select at least two journals to view a comparison.", "至少选择两本期刊后查看对比。"), "journal-state"));
    return wrap;
  }
  const max = Math.max(1, ...items.flatMap(item => years.map(y => stats[item.id]?.counts?.[y] ?? 0)));
  wrap.append(table([t("Metric", "指标"), ...items.map(item => link(item.url, item.abbreviation) || item.abbreviation)],
    [["CCF", ...items.map(item => item.ccf ? link(item.ccf.url, rank(item)) || rank(item) : rank(item))],
      [t("Access", "开放获取"), ...items.map(item => access()[item.access || "unknown"] || missing)],
      [t("OpenAlex indexed works", "OpenAlex 收录量"), ...items.map(item => el("div", {}, chart(item, max), statSource(item)))],
      ...fields().filter(([key]) => key !== "scope").map(([key, title]) => [title, ...items.map(item => metric(item.details?.[key]))])],
    t("Journal comparison", "期刊对比")));
  return wrap;
}
function download(name, text, type) {
  const href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  const a = el("a", { href, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function favorites() {
  const keys = Object.keys(notes);
  const upload = el("input", { type: "file", accept: ".json,application/json", "aria-label": t("Import favorites JSON", "导入收藏 JSON"), hidden: true });
  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("File too large");
      const imported = sanitizeNotes(JSON.parse(await file.text()), allowed);
      notes = Object.assign(Object.create(null), notes, imported);
      persist(); statusText = "imported";
    } catch { statusText = "invalid"; }
    rerender();
  });
  return el("section", {},
    p(t("Favorites and notes stay in this browser. Export a JSON backup to use them elsewhere.", "收藏和备注只保存在当前浏览器。换设备时可导出 JSON，再手动导入。"),
      "journal-muted"),
    !storageWorks ? p(t("Browser storage is unavailable. Export to keep your changes.", "浏览器存储不可用，请导出以保存更改。"), "journal-state") : null,
    el("div", { class: "journal-actions" },
      button(t("Export favorites", "导出收藏"), () => download("journal-favorites.json", JSON.stringify({ version: 1, items: notes }, null, 2), "application/json")),
      button(t("Import and merge", "导入并合并"), () => upload.click()), upload),
    statusText ? el("p", { role: "status" }, statusText === "imported" ? t("Favorites imported.", "收藏已导入。") :
      statusText === "invalid" ? t("This file is not a valid favorites backup.", "不是有效的收藏备份文件。") : t("Note saved.", "备注已保存。")) : null,
    keys.length ? el("ul", { class: "journal-notes" }, keys.map(key => {
      const id = key.slice(2);
      const item = key.startsWith("j:") ? byId.get(id) : callById.get(id);
      const label = item?.name || item?.title || id;
      const input = el("textarea", { maxlength: 4000, value: notes[key], oninput: event => { notes[key] = event.target.value; persist(); } });
      return el("li", { class: "journal-note" }, link(item?.url, label) || label,
        el("label", {}, t("Private note", "个人备注"), input), favorite(key));
    })) : p(t("Save journals from the journal library.", "可在期刊资料库收藏期刊。"), "journal-state"));
}
function render() {
  const labels = { library: t("Journal library", "期刊资料库"), tracker: t("Special issues", "特刊追踪"),
    comparison: t("Compare", "对比分析"), favorites: t("My favorites", "我的关注") };
  if (!journals) {
    app.replaceChildren(p(t("Journal data could not load. Reload the page to try again.", "未能加载期刊数据，请刷新页面重试。"), "journal-state"));
    return;
  }
  const checked = snapshot.generated_at?.slice(0, 10);
  meta.textContent = t(journals.length + " journals", "收录 " + journals.length + " 本") +
    (checked ? t(" · Updated ", " · 更新于 ") + checked : "");
  app.replaceChildren(el("nav", { class: "journal-tabs", "aria-label": t("Journal Explorer views", "期刊观察功能") },
    Object.entries(labels).map(([key, title]) => button(title + (key === "comparison" && selected.size ? " (" + selected.size + ")" : ""), () => {
      tab = key; statusText = ""; rerender();
    }, { "aria-pressed": String(tab === key), "data-focus": "tab-" + key }))),
    { library, tracker, comparison, favorites }[tab]());
}
function syncLanguageQuery() {
  const url = new URL(location.href);
  if (url.searchParams.has("lang") && url.searchParams.get("lang") !== root.dataset.lang) {
    url.searchParams.set("lang", root.dataset.lang);
    history.replaceState(history.state, "", url);
  }
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
    byId = new Map(journals.map(item => [item.id, item]));
    callById = new Map(calls.map(item => [item.id, item]));
    allowed = new Set([...journals.map(item => "j:" + item.id), ...calls.map(item => "c:" + item.id)]);
    try {
      const saved = localStorage.getItem(localKey);
      if (saved) notes = sanitizeNotes(JSON.parse(saved), allowed);
    } catch { storageWorks = false; }
    render();
  } catch { journals = null; render(); }
  new MutationObserver(() => {
    syncLanguageQuery();
    rerender();
  }).observe(root, { attributes: true, attributeFilter: ["data-lang"] });
}
window.addEventListener("popstate", () => {
  society = societyFromUrl();
  tab = "tracker";
  syncLanguageQuery();
  render();
});
start();
