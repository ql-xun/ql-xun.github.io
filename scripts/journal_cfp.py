"""Parse explicitly supported publisher layouts, never arbitrary user URLs."""

from datetime import datetime
import hashlib
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup


COMSOC = "www.comsoc.org"
PUBLISHERS = {COMSOC, "www.computer.org", "signalprocessingsociety.org",
              "ieee-iotj.org", "vtsociety.org", "www.vtsociety.org"}
MONTH = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
DATE = rf"\b(?:\d{{1,2}}[ -]+{MONTH}[ ,.-]+\d{{4}}|{MONTH} \d{{1,2}}(?:st|nd|rd|th)?,? \d{{4}}|\d{{4}}-\d{{2}}-\d{{2}})\b"


def clean(value):
    return " ".join(value.split())


def deadline_date(value):
    match = re.search(DATE, value, re.I)
    if not match:
        return None
    value = match.group(0).replace("Sept ", "Sep ").replace("Sept-", "Sep-")
    value = re.sub(r"(?<=\d)(?:st|nd|rd|th)\b", "", value, flags=re.I)
    value = value if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else value.replace("-", " ").replace(",", " ")
    for fmt in ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(clean(value), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def official_url(base, href):
    parts = urlsplit(urljoin(base, href))
    if parts.scheme != "https" or parts.hostname not in PUBLISHERS or parts.username or parts.password or parts.port:
        return None
    return urlunsplit(("https", parts.hostname, parts.path.rstrip("/") or "/", "", ""))


def record(journal_id, url, title, deadline, publication=None):
    title, deadline = clean(title), clean(deadline)
    if not title or not url:
        raise ValueError("CFP record lacks title or official URL")
    status = "closed" if deadline.lower() in {"closed", "discontinued", "withdrawn"} else (
        "ongoing" if deadline.lower() == "ongoing" else "dated" if deadline_date(deadline) else "unknown"
    )
    return {
        "id": journal_id + "-" + hashlib.sha256(url.encode()).hexdigest()[:18],
        "journal_id": journal_id,
        "url": url,
        "title": title,
        "status": status,
        "deadline": deadline_date(deadline),
        "deadline_text": deadline or None,
        "publication": clean(publication) if publication else None,
    }


def text(node):
    return clean(node.get_text(" ", strip=True))


def comsoc(soup, journal_id, url):
    calls = []
    found = False
    for table in soup.select("table"):
        headers = [text(cell).lower() for cell in table.select("th")]
        if not any("deadline" in col for col in headers):
            continue
        if not any("topic" in col for col in headers) or "publication date" not in headers:
            continue
        title_col = next(i for i, header in enumerate(headers) if "topic" in header)
        date_col = next(i for i, header in enumerate(headers) if "deadline" in header)
        pub_col = headers.index("publication date")
        found = True
        for row in table.select("tr"):
            cells = row.find_all("td", recursive=False)
            if not cells:
                continue
            if len(cells) <= max(title_col, date_col, pub_col):
                raise ValueError("Unexpected ComSoc table row")
            title = text(cells[title_col])
            if re.search(r"call for special issue proposals|^open call for papers$", title, re.I):
                continue
            anchor = cells[title_col].find("a", href=True)
            if not anchor:
                raise ValueError("Unexpected CFP without detail link")
            calls.append(record(journal_id, official_url(url, anchor["href"]), title,
                                text(cells[date_col]), text(cells[pub_col])))
    if not found:
        # These publisher pages explicitly have an empty list instead of a table.
        main = soup.find("main")
        if main and re.search(r"\b(?:no (?:open |current |active )?(?:calls for papers|special issues)(?: at this time)?|there are currently no calls)\b", text(main), re.I):
            return []
        raise ValueError("Expected ComSoc CFP table was not found")
    return calls


def sps(soup, journal_id, url):
    if not any("Special Issue Deadlines" in text(node) for node in soup.select("h1")):
        raise ValueError("SPS directory heading not found")
    articles = soup.select("main .views-row article")
    if not articles:
        raise ValueError("SPS directory cards not found")
    calls = []
    for article in articles:
        heading = article.select_one("h4 a[href]")
        if not heading or not re.search(r"\bJ-?STSP\b", text(heading), re.I):
            continue
        body = text(article)
        date = re.search(rf"(?:submission(?: deadline)?|manuscript due)\s*:\s*({DATE})", body, re.I)
        publication = re.search(r"(?:publication date(?: \(tentative\))?|planned publication)\s*:\s*(.+?)(?:Read more|$)", body, re.I)
        calls.append(record(journal_id, official_url(url, heading["href"]), text(heading),
                            date.group(1) if date else "", publication.group(1) if publication else None))
    return calls


def cs(soup, journal_id, url):
    if not any("Calls for Papers in Computer Science" in text(node) for node in soup.select("h1")):
        raise ValueError("Computer Society directory heading not found")
    anchors = soup.select('a[href*="/digital-library/"][href*="/cfp-"]')
    if not anchors:
        raise ValueError("Computer Society CFP list not found")
    calls = []
    for anchor in anchors:
        if "/journals/tq/" not in anchor["href"] or not re.search(r"special (?:issue|section|collection)", text(anchor), re.I):
            continue
        card = anchor.parent.parent
        body = text(card)
        match = re.search(rf"(?:submission deadline|deadline|submissions due)\s*:?\s*({DATE})", body, re.I)
        publication = re.search(r"(?:expected publication|publication date)\s*:\s*((?:Early |Late |Mid-)?(?:[A-Za-z]+ )?\d{4})", body, re.I)
        calls.append(record(journal_id, official_url(url, anchor["href"]),
                            re.sub(r"^CFP:\s*", "", text(anchor)), match.group(1) if match else "",
                            publication.group(1) if publication else None))
    return calls


def iotj(soup, journal_id, url):
    main = soup.select_one(".entry-content") or soup.find("main")
    if not main or not re.search(r"special issues", text(soup.find("title") or main), re.I):
        raise ValueError("IoTJ Special Issues listing not found")
    calls = []
    for anchor in main.select("a[href]"):
        title = text(anchor)
        if not title or not re.search(r"\.pdf(?:$|\?)|/special-issues/", anchor["href"], re.I):
            continue
        body = text(anchor.find_parent(["li", "tr", "p"]) or anchor)
        match = re.search(rf"(?:submission(?: deadline)?|deadline|due)\s*:?\s*({DATE})", body, re.I)
        href = official_url(url, anchor["href"])
        if href and href != official_url(url, url):
            section = anchor.find_previous("h4")
            closed = section and "closed special issues" in text(section).lower()
            entry = record(journal_id, href, title, "Closed" if closed else match.group(1) if match else "")
            editors = re.search(r"guest editors?\s*:\s*(.+)$", body, re.I)
            if editors:
                entry["editors"] = [clean(name) for name in editors.group(1).split(",") if clean(name)]
            calls.append(entry)
    if not calls:
        raise ValueError("Expected IoTJ CFP links were not found")
    return calls


def tvt(soup, journal_id, url):
    calls = []
    for anchor in soup.select('h3 a[href$=".pdf"]'):
        href = official_url(url, anchor["href"])
        title = text(anchor)
        if href and re.search(r"special (?:issue|section)", title, re.I):
            calls.append(record(journal_id, href, title, ""))
    if not calls:
        raise ValueError("Expected TVT special section links were not found")
    return calls


def parser_for(url, journal_id):
    host = urlsplit(url).hostname
    if host == COMSOC:
        return comsoc
    return {"jstsp": sps, "tdsc": cs, "iotj": iotj, "tvt": tvt}.get(journal_id) if host in PUBLISHERS else None


def parse_page(html, url, journal_id):
    parser = parser_for(url, journal_id)
    if not parser:
        raise ValueError("No parser for this journal")
    return parser(soup_for(html), journal_id, url)


def soup_for(html):
    return BeautifulSoup(html, "html.parser", **({"from_encoding": "utf-8"} if isinstance(html, bytes) else {}))


def detail_fields(html):
    soup = soup_for(html)
    body = soup.find("main") or soup
    editors = []
    for heading in body.find_all(["h2", "h3", "h4", "strong"]):
        if not re.fullmatch(r"(?:lead )?guest editors?:?", text(heading), re.I):
            continue
        node = (heading.parent if heading.name == "strong" else heading).find_next_sibling()
        if node and node.name in {"p", "ul", "ol", "div"}:
            editors = [text(a) for a in node.select('a[href^="mailto:"]') if text(a)]
            if not editors:
                editors = [text(a) for a in node.select("li,strong") if text(a)]
            if not editors and node.name == "p":
                editors = [clean(line).split(",")[0] for line in node.get_text("\n", strip=True).splitlines() if "," in line]
        break
    deadline = re.search(rf"(?:manuscript submission deadline|submission deadline|manuscript submission date|manuscript due)\s*:?\s*({DATE})",
                         text(body), re.I)
    return list(dict.fromkeys(editors))[:24], deadline_date(deadline.group(1)) if deadline else None


def pdf_fields(body):
    """Extract only explicitly labeled dates and editor names from official CFPs."""
    date = re.search(rf"(?:manuscript submission deadline|submission deadline|manuscript due|submission due)\s*:?\s*({DATE})",
                     clean(body), re.I)
    publication = re.search(rf"(?:publication date|expected publication)\s*:\s*({MONTH}\s+\d{{4}})", clean(body), re.I)
    editors = []
    if match := re.search(r"(?im)^\s*(?:guest editors?|guest editorial team)\s*:?\s*$", body):
        for line in body[match.end():].splitlines():
            if not clean(line):
                continue
            line = re.sub(r"^[\s•·*-]+", "", line)
            name = clean(line.split(",", 1)[0])
            if "," not in line or len(name.split()) not in {2, 3, 4, 5} or "@" in name or ":" in name:
                break
            editors.append(name)
    return editors[:24], deadline_date(date.group(1)) if date else None, publication.group(1) if publication else None
