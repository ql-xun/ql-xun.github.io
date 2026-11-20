"""Parse explicitly supported publisher layouts, never arbitrary user URLs."""

from datetime import date, datetime
import hashlib
import re
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup


COMSOC = "www.comsoc.org"
COMPUTER = "www.computer.org"
SPS = "signalprocessingsociety.org"
SCIS = "scis.scichina.com"
CS_JOURNALS = {"tdsc": "tq", "taffc": "ta", "tetc": "ec"}
# Unversioned CS detail caches flattened linked editor names and affiliations.
CS_DETAIL_VERSION = 2
PUBLISHERS = {COMSOC, COMPUTER, SPS, SCIS,
              "ieee-iotj.org", "vtsociety.org", "www.vtsociety.org"}
MONTH = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
DATE = rf"\b(?:\d{{1,2}}[ -]+{MONTH}[ ,.-]+\d{{4}}|{MONTH}\.? \d{{1,2}}(?:st|nd|rd|th)?,? \d{{4}}|\d{{4}}-\d{{2}}-\d{{2}})\b"
SUBMISSION = (r"(?:manuscript )?submissions? (?:deadline|due|date)|deadline for (?:manuscript )?submissions?"
              r"|manuscripts? due")
CLOSED = {"closed", "discontinued", "withdrawn"}


def clean(value):
    return " ".join(value.split())


def deadline_date(value):
    match = re.search(DATE, value, re.I)
    if not match:
        return None
    value = re.sub(r"\bSept\b", "Sep", match.group(0), flags=re.I)
    value = re.sub(r"(?<=\d)(?:st|nd|rd|th)\b", "", value, flags=re.I)
    value = value if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else re.sub(r"[,.-]", " ", value)
    for fmt in ("%d %B %Y", "%d %b %Y", "%B %d %Y", "%b %d %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(clean(value), fmt).date().isoformat()
        except ValueError:
            pass
    return None


def submission_text(body, labels=SUBMISSION):
    for match in re.finditer(rf"\b(?:{labels})\s*:?\s*({DATE}|{'|'.join(sorted(CLOSED))}\b)", body, re.I):
        if not re.search(r"\b(?:revised|revision|final|camera[- ]ready)(?: manuscripts?)?\s*$",
                         body[max(0, match.start() - 40):match.start()], re.I):
            return match.group(1)
    return ""


def official_url(base, href):
    parts = urlsplit(urljoin(base, href))
    if parts.scheme != "https" or parts.hostname not in PUBLISHERS or parts.username or parts.password or parts.port:
        return None
    return urlunsplit(("https", parts.hostname, parts.path.rstrip("/") or "/", "", ""))


def record(journal_id, url, title, deadline, publication=None, *, identity=None):
    title, deadline = clean(title), clean(deadline)
    if not title or not url:
        raise ValueError("CFP record lacks title or official URL")
    parsed_date = deadline_date(deadline)
    status = "closed" if deadline.lower() in CLOSED else (
        "ongoing" if deadline.lower() == "ongoing" else "dated" if parsed_date else "unknown"
    )
    return {
        "id": journal_id + "-" + hashlib.sha256((identity or url).encode()).hexdigest()[:18],
        "journal_id": journal_id,
        "url": url,
        "title": title,
        "status": status,
        "deadline": parsed_date,
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
        if main and journal_id == "ton":
            # TNET sometimes places a single full CFP on the landing page itself.
            headings = [text(node) for node in main.select("h2")
                        if re.search(r"\bTransactions on Networking\s+Special (?:Issue|Section)\b", text(node), re.I)]
            if len(headings) == 1:
                body = text(main)
                deadline = submission_text(body)
                if not deadline:
                    raise ValueError("TNET CFP submission deadline not found")
                publication = re.search(rf"\bPlanned Publication\s*:\s*({MONTH}\s+\d{{4}})", body, re.I)
                href = official_url(url, url)
                return [record(journal_id, href, headings[0], deadline,
                               publication.group(1) if publication else None,
                               identity=f"{href}\n{headings[0].casefold()}")]
        raise ValueError("Expected ComSoc CFP table was not found")
    return calls


def sps(soup, journal_id, url):
    if not any("Special Issue Deadlines" in text(node) for node in soup.select("h1")):
        raise ValueError("SPS directory heading not found")
    articles = soup.select("main .views-row article")
    if not articles:
        raise ValueError("SPS directory cards not found")
    journal_label = {
        "jstsp": r"\b(?:J[- ]?STSP|Journal of Selected Topics in Signal Processing)\b",
        "tsp": r"\b(?:T[- ]?SP|Transactions on Signal Processing)\b",
    }[journal_id]
    calls = []
    for article in articles:
        heading = article.select_one("h4 a[href]")
        if not heading or not re.search(journal_label, text(heading), re.I):
            continue
        body = text(article)
        publication = re.search(r"(?:publication date(?: \(tentative\))?|planned publication)\s*:\s*(.+?)(?:Read more|$)", body, re.I)
        calls.append(record(journal_id, official_url(url, heading["href"]), text(heading),
                            submission_text(body, SUBMISSION + r"|(?:manuscript )?submission(?=\s*:)"),
                            publication.group(1) if publication else None))
    return calls


def cs(soup, journal_id, url):
    if not any("Calls for Papers in Computer Science" in text(node) for node in soup.select("h1")):
        raise ValueError("Computer Society directory heading not found")
    anchors = soup.select('a[href*="/digital-library/journals/"]')
    if not anchors:
        raise ValueError("Computer Society CFP list not found")
    calls = []
    prefix = "/digital-library/journals/" + CS_JOURNALS[journal_id] + "/"
    for anchor in anchors:
        title = re.sub(r"^(?:CFP|Call for papers):\s*", "", text(anchor), flags=re.I)
        if not urlsplit(anchor["href"]).path.startswith(prefix) or not re.search(r"\bspecial (?:issue|section|collection)\b", title, re.I):
            continue
        href = official_url(url, anchor["href"])
        if not href or urlsplit(href).hostname != COMPUTER:
            raise ValueError("Computer Society CFP link is not official")
        card = anchor.parent.parent
        body = text(card)
        deadline = "Closed" if re.search(r"\b(?:closed|withdrawn)\s*[:–—-]", title, re.I) else submission_text(body, SUBMISSION + r"|deadline")
        publication = re.search(r"(?:expected publication|publication date)\s*:\s*((?:Early |Late |Mid-)?(?:[A-Za-z]+ )?\d{4})", body, re.I)
        calls.append(record(journal_id, href, title, deadline,
                            publication.group(1) if publication else None))
    return calls


def scis(soup, journal_id, url):
    heading = next((node for node in soup.select("h2,h3,h4,h5")
                    if re.fullmatch(r"Call for papers\s*/\s*征稿启事", text(node), re.I)), None)
    if not heading:
        raise ValueError("SCIS CFP section not found")
    calls = []
    ssi_only = False
    links = []
    for node in heading.find_next_siblings():
        if node.name in {"h2", "h3", "h4", "h5"}:
            break
        links.extend([node] if node.name == "a" and node.has_attr("href") else node.select("a[href]"))
    for anchor in links:
        row = anchor.find_parent(["li", "p"]) or anchor.parent
        if re.match(r"^SSI\b", text(row)):
            ssi_only = True
            continue
        if not re.match(r"^SCIS\b", text(row)):
            continue
        parts = urlsplit(urljoin(url, anchor["href"]))
        if (parts.scheme not in {"http", "https"} or parts.hostname != SCIS or parts.port
                or parts.username or parts.password or not re.fullmatch(r"/cfp/scis[^/]*\.pdf", parts.path, re.I)):
            raise ValueError("Unexpected SCIS CFP document")
        # The journal page advertises some public PDF links with an HTTP scheme.
        href = official_url(url, parts._replace(scheme="https").geturl())
        title = text(anchor)
        match = re.search(r"\s*[(（](\d{4})\.(\d{1,2})\.(\d{1,2})[)）]\s*$", title)
        deadline = date(*map(int, match.groups())).isoformat() if match else ""
        calls.append(record(journal_id, href, title[:match.start()] if match else title, deadline))
    if not calls and not ssi_only:
        raise ValueError("SCIS CFP rows not found")
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
    if host == COMPUTER and journal_id in CS_JOURNALS:
        return cs
    if host == SPS and journal_id in {"tsp", "jstsp"}:
        return sps
    if host == SCIS and journal_id == "scis":
        return scis
    if host == "ieee-iotj.org" and journal_id == "iotj":
        return iotj
    if host in {"vtsociety.org", "www.vtsociety.org"} and journal_id == "tvt":
        return tvt
    return None


def parse_page(html, url, journal_id):
    parser = parser_for(url, journal_id)
    if not parser:
        raise ValueError("No parser for this journal")
    return parser(soup_for(html), journal_id, url)


def soup_for(html):
    return BeautifulSoup(html, "html.parser", **({"from_encoding": "utf-8"} if isinstance(html, bytes) else {}))


def editor_name(line):
    name = clean(re.split(r"[,，]", line, maxsplit=1)[0].strip(" ,，;；"))
    name = re.sub(r"^(?:Dr|Prof)\.?\s+", "", name)
    name = re.sub(r"\s*\((?:lead|(?:(?:lead|commissioning|corresponding) )?guest editor)\)$", "", name, flags=re.I)
    name = re.sub(r"\s+([.])", r"\1", name)
    if re.fullmatch(r"[\u3400-\u9fff]{2,6}", name):
        return name
    if (2 <= len(name.split()) <= 7 and name[0].isupper() and
            re.fullmatch(r"[^\W\d_][^\d@:<>,;=/]*", name) and not re.search(r"university|institute|editorial office", name, re.I)):
        return name
    return None


def listed_editor(row):
    line = text(row)
    anchor = row.find("a", href=True)
    if anchor is not None:
        # Only a leading name link identifies the editor. Never follow the
        # link or treat a later institution/contact link as a person's name.
        label = text(anchor)
        if label and line.startswith(label) and (name := editor_name(label)):
            return name
    return editor_name(line)


def detail_fields(html):
    soup = soup_for(html)
    body = next((article for article in soup.select("article.general-post-content") if text(article)), None)
    body = body or soup.find("main") or soup
    editors = []
    for heading in body.find_all(["h2", "h3", "h4", "h5", "strong", "b", "p"]):
        if not re.fullmatch(r"(?:(?:lead )?guest editors?|contact (?:the )?guest editors? at)\s*:?", text(heading), re.I):
            continue
        node = heading.find_next_sibling()
        if node is None and heading.name in {"strong", "b"}:
            node = heading.parent.find_next_sibling()
        if node and node.name in {"p", "ul", "ol", "div"}:
            if rows := node.select("li"):
                editors = [name for row in rows if (name := listed_editor(row))]
            else:
                editors = [name for line in node.get_text("\n", strip=True).splitlines() if (name := editor_name(line))]
        if editors:
            break
    deadline = submission_text(text(body))
    return list(dict.fromkeys(editors))[:24], "Closed" if deadline.lower() in CLOSED else deadline_date(deadline)


def pdf_fields(body):
    """Extract only explicitly labeled dates and editor names from official CFPs."""
    deadline = submission_text(clean(body))
    publication = re.search(rf"(?:publication date|expected publication)\s*:\s*({MONTH}\s+\d{{4}})", clean(body), re.I)
    editors = []
    lines = iter(body.splitlines())
    if any(re.fullmatch(r"(?:guest editors?|guest editorial team)\s*:?", clean(line), re.I) for line in lines):
        for line in lines:
            line = re.sub(r"^[\s•·*-]+", "", line)
            if re.match(r"^(?:contact|important dates|submission(?: instructions| guidelines| deadline)?|references|scope)\b", line, re.I):
                break
            if re.search(r"[,，]", line) and (name := editor_name(line)):
                editors.append(name)
    return (list(dict.fromkeys(editors))[:24], "Closed" if deadline.lower() in CLOSED else deadline_date(deadline),
            publication.group(1) if publication else None)
