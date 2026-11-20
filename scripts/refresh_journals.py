"""Refresh publisher CFPs and OpenAlex counts; retain the last verified snapshot."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from journal_cfp import CS_DETAIL_VERSION, CS_JOURNALS, PUBLISHERS, detail_fields, parse_page, parser_for, pdf_fields
from journal_digest import create_digest

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "tools/journals"
LIVE = "https://ql-xun.github.io/tools/journals/snapshot.json"
OPENALEX = "https://api.openalex.org"
SHANGHAI = timezone(timedelta(hours=8))
SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def https_url(url):
    if not isinstance(url, str):
        return False
    parts = urlsplit(url)
    return parts.scheme == "https" and bool(parts.hostname) and not parts.username and not parts.password


class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new, old = urlsplit(newurl), urlsplit(req.full_url)
        allowed = new.hostname == old.hostname or {new.hostname, old.hostname} <= {"vtsociety.org", "www.vtsociety.org"}
        if not allowed or not https_url(newurl) or new.port:
            raise ValueError("Refusing non-official redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_url(url, hosts, *, accept="text/html", limit=5_000_000):
    parts = urlsplit(url)
    require(https_url(url) and not parts.port and parts.hostname in hosts, "Host is not an approved source")
    headers = {"User-Agent": "JournalExplorer/1.0 (+https://ql-xun.github.io/tools/journals/)", "Accept": accept}
    if parts.hostname == "api.openalex.org" and os.environ.get("OPENALEX_API_KEY"):
        headers["Authorization"] = "Bearer " + os.environ["OPENALEX_API_KEY"]
    req = Request(url, headers=headers)
    for attempt in range(2):
        try:
            with build_opener(OfficialRedirect()).open(req, timeout=16) as response:
                length = response.headers.get("Content-Length", "")
                data = response.read(limit + 1)
            require(len(data) <= limit, "Source response too large")
            if length.isdecimal() and len(data) != int(length):
                raise URLError("Incomplete source response")
            return data
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt:
                raise
            delay = error.headers.get("Retry-After", "")
            # Leave old data in place when the server asks for a longer pause.
            if delay and (not delay.isdecimal() or int(delay) > 12):
                raise
            time.sleep(max(2, int(delay)) if delay else 2)
        except (URLError, TimeoutError):
            if attempt:
                raise
            time.sleep(2)


def openalex(path, params=None):
    url = OPENALEX + path + ("?" + urlencode(params) if params else "")
    return json.loads(read_url(url, {"api.openalex.org"}, accept="application/json"))


def resolve_sources(issns):
    mapping = {}
    # OpenAlex filters accept a bounded OR list. One GET per batch is sufficient.
    for start in range(0, len(issns), 40):
        chunk = issns[start:start + 40]
        response = openalex("/sources", {
            "filter": "issn:" + "|".join(chunk), "per_page": 100,
            "select": "id,issn,issn_l,type",
        })
        for issn in chunk:
            matches = [source for source in response["results"] if issn in (source.get("issn") or [])
                       and source.get("type") == "journal"]
            if len(matches) == 1:
                source = matches[0]
                key = source["id"].split("/")[-1]
                if re.fullmatch(r"S\d+", key):
                    mapping[issn] = (key, source.get("issn_l"))
    return mapping


def annual_stats(journal, mapping, old, now):
    result = deepcopy(old)
    try:
        source, issn_l = mapping[journal["issn"]]
        counts = {}
        year_sources = {}
        for year in range(now.year - 5, now.year + 1):
            previous = next((entry for entry in sorted(journal.get("previous_issns", []), key=lambda item: item["through"])
                             if year <= entry["through"]), None)
            key = mapping[previous["issn"]][0] if previous else source
            response = openalex("/works", {"filter": f"primary_location.source.id:{key},publication_year:{year},type:article|review",
                                           "per_page": 1, "select": "id"})
            count = response["meta"]["count"]
            require(type(count) is int and count >= 0, "Invalid OpenAlex record count")
            counts[str(year)] = count
            year_sources[str(year)] = key
            time.sleep(.45)  # At most ~4.5 requests/s with two metric workers.
        result = {"counts": counts, "year_sources": year_sources, "issn_l": issn_l,
                  "openalex_id": source, "checked_at": now.isoformat(), "status": "ok"}
    except (ValueError, KeyError, OSError, TypeError) as error:
        result["status"] = "error"
        print(f"OpenAlex {journal['id']}: {error_summary(error)}", flush=True)
    return journal["id"], result


def error_summary(error):
    # Never echo response bodies, arbitrary remote strings, or credential-bearing URLs.
    return f"HTTP {error.code}" if isinstance(error, HTTPError) else type(error).__name__


def saved_detail(item, prior, prefer_detail):
    if not prior.get("detail_checked_at"):
        return
    item["detail_checked_at"] = prior["detail_checked_at"]
    if "cs_detail_version" in prior:
        item["cs_detail_version"] = prior["cs_detail_version"]
    if prior["status"] == "closed" or ((prefer_detail or item["status"] == "unknown") and prior.get("deadline")):
        item["deadline"], item["status"] = prior["deadline"], prior["status"]
        if prior.get("deadline_source"):
            item["deadline_source"] = prior["deadline_source"]
    item["publication"] = item["publication"] or prior.get("publication")


def refresh_source(journal, old, prior_calls, now):
    journal_id = journal["id"]
    url = journal.get("cfp_url")
    if not url or not parser_for(url, journal_id):
        return journal_id, {"status": "unsupported"}, None
    try:
        records = parse_page(read_url(url, PUBLISHERS), url, journal_id)
        today = now.date()
        prefer_detail = journal_id in CS_JOURNALS or journal_id == "scis"
        budget = 20
        for item in records:
            prior = prior_calls.get(item["id"], {})
            item["editors"] = item.get("editors") or prior.get("editors", [])
            if item["status"] == "closed":
                continue
            published_date = item["deadline"]
            active = item["status"] in {"ongoing", "unknown"} or bool(published_date and published_date >= today.isoformat())
            was_active = prior.get("deadline", "") and prior["deadline"] >= today.isoformat()
            # A stale directory date can be earlier than the date on the CS detail page.
            if not (active or journal_id in CS_JOURNALS or (prefer_detail and was_active)):
                continue
            is_pdf = item["url"].lower().endswith(".pdf")
            if is_pdf and journal_id not in {"tvt", "scis"}:
                continue  # IoTJ publishes dates and editors directly on its list.
            last = prior.get("detail_checked_at", "")
            # SCIS may replace a PDF in place while its directory remains unchanged.
            max_age = 0 if journal_id == "scis" else 1 if prefer_detail else 7
            fresh = (last and not prior.get("detail_stale") and 0 <= (today - date.fromisoformat(last[:10])).days < max_age
                     and (journal_id not in CS_JOURNALS or prior.get("cs_detail_version") == CS_DETAIL_VERSION)
                     and (not prefer_detail or prior.get("deadline_source") == item["url"]))
            if fresh and prior.get("deadline_text") == item["deadline_text"]:
                saved_detail(item, prior, prefer_detail)
                continue
            if budget <= 0:
                saved_detail(item, prior, prefer_detail)
                item["detail_stale"] = True
                continue
            budget -= 1
            try:
                raw = read_url(item["url"], PUBLISHERS, accept="application/pdf" if is_pdf else "text/html")
                if is_pdf:
                    layout = ["-raw"] if journal_id == "scis" else []
                    plain = subprocess.run(["pdftotext", *layout, "-enc", "UTF-8", "-f", "1", "-l", "8", "-", "-"],
                                           input=raw, capture_output=True, timeout=12, check=True).stdout.decode("utf-8", "replace")
                    editors, detail_date, publication = pdf_fields(plain)
                    item["publication"] = publication or item["publication"]
                else:
                    editors, detail_date = detail_fields(raw)
                if prefer_detail and not detail_date:
                    raise ValueError("Official CFP submission deadline not found")
                if editors:
                    item["editors"] = editors
                if journal_id in CS_JOURNALS and (editors or not prior.get("editors")):
                    item["cs_detail_version"] = CS_DETAIL_VERSION
                item["detail_checked_at"] = now.isoformat()
                if detail_date == "Closed":
                    item["deadline"], item["status"] = None, "closed"
                    item["deadline_source"] = item["url"]
                elif detail_date and (prefer_detail or item["status"] == "unknown"):
                    item["deadline"], item["status"] = detail_date, "dated"
                    item["deadline_source"] = item["url"]
            except (ValueError, OSError, subprocess.SubprocessError) as error:
                saved_detail(item, prior, prefer_detail)
                if journal_id in CS_JOURNALS and not prior.get("deadline") and item["status"] != "closed":
                    item["deadline"], item["status"] = None, "unknown"
                item["detail_stale"] = True
                print(f"CFP detail {item['id']}: {error_summary(error)}", flush=True)
        print(f"CFP {journal_id}: {len(records)} entries", flush=True)
        return journal_id, {"status": "ok", "checked_at": now.isoformat(), "url": url}, records
    except (ValueError, OSError, AttributeError, IndexError) as error:
        print(f"CFP {journal_id}: {error_summary(error)}; retaining previous data", flush=True)
        return journal_id, {**old, "status": "error", "url": url}, None


def merge_source(calls, journal_id, records, now):
    """Retain prior records that vanish from a successfully parsed list."""
    recorded = {}
    for record in records:
        key = record["id"]
        if key in recorded and recorded[key] != record:
            # Two official rows with conflicting values need review.
            first = recorded[key]
            record = {**first, "deadline": None, "status": "unknown",
                      "deadline_text": "Conflicting dates in publisher list"}
        recorded[key] = record
    for key, prior in list(calls.items()):
        if prior["journal_id"] == journal_id and key not in recorded:
            calls[key] = {**prior, "listed": False}
    for key, item in recorded.items():
        old = calls.get(key)
        history = list(old.get("history", [])) if old else [{"kind": "new", "at": now, "to": item["deadline"]}]
        version = old.get("deadline_version", 0) if old else 0
        if old and item["status"] == "closed" and not item["deadline"]:
            item = {**item, "deadline": old["deadline"]}
        if old and item["deadline"] != old["deadline"]:
            version += 1
            history.append({"kind": "deadline", "at": now, "from": old["deadline"], "to": item["deadline"]})
        if old and old["status"] != "closed" and item["status"] == "closed":
            history.append({"kind": "closed", "at": now})
        calls[key] = {**item, "listed": True, "checked_at": now,
                      "deadline_version": version, "history": history}
    return {key for key, item in recorded.items() if not item.get("detail_stale")}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(path)


def validate_editor(editor, journal_id, *, allow_co_editors=True):
    require(isinstance(editor, dict) and isinstance(editor.get("name"), str) and
            editor["name"].strip() and https_url(editor.get("source")), f"Invalid chief editor: {journal_id}")
    since = editor.get("since")
    if since is not None:
        require(isinstance(since, str) and re.fullmatch(r"\d{4}(?:-\d{2}(?:-\d{2})?)?", since)
                and https_url(editor.get("since_source")), f"Invalid editor appointment: {journal_id}")
        date.fromisoformat(since + "-01" * (2 - since.count("-")))
    else:
        require(not editor.get("since_source"), f"Appointment source has no date: {journal_id}")
    if successor := editor.get("next"):
        require(isinstance(successor, dict) and isinstance(successor.get("since"), str)
                and re.fullmatch(r"\d{4}-\d{2}-\d{2}", successor["since"])
                and (not since or successor["since"] > since) and "next" not in successor,
                f"Invalid editor transition: {journal_id}")
        validate_editor(successor, journal_id, allow_co_editors=False)
    if "co_editors" in editor:
        colleagues = editor["co_editors"]
        require(allow_co_editors and isinstance(colleagues, list) and colleagues, f"Invalid co-editors: {journal_id}")
        names = {editor["name"].casefold().strip()}
        for colleague in colleagues:
            validate_editor(colleague, journal_id, allow_co_editors=False)
            name = colleague["name"].casefold().strip()
            require(name not in names, f"Duplicate chief editor: {journal_id}")
            names.add(name)


def validate_impact(impact, journal_id):
    require(isinstance(impact, dict) and https_url(impact.get("url")), f"Unsourced impact factor: {journal_id}")
    value, year = impact.get("value"), impact.get("year")
    require(type(value) in {int, float} and 0 <= value < float("inf"), f"Invalid impact factor: {journal_id}")
    require(year is None or (type(year) is int and 1900 <= year <= 9999), f"Invalid impact factor year: {journal_id}")
    checked = date.fromisoformat(impact["checked_at"])
    require(year is None or year <= checked.year, f"Future impact factor year: {journal_id}")


def validate_registry(journals):
    require(isinstance(journals, list) and bool(journals), "Journal registry is empty")
    ids = set()
    issns = set()
    for row in journals:
        key = row["id"]
        require(SLUG.fullmatch(key) and key not in ids, "Journal IDs must be unique slugs")
        ids.add(key)
        issn = row["issn"]
        require(re.fullmatch(r"\d{4}-\d{3}[\dX]", issn) and issn not in issns, "Invalid or duplicate ISSN")
        issns.add(issn)
        require(bool(row["name"].strip()) and bool(row["abbreviation"].strip()), "Journal name required")
        for name in ("url", "guidelines", "submission", "cfp_url", "identity_url", "access_url"):
            if name == "url" or row.get(name):
                require(https_url(row.get(name)), f"Invalid journal link: {key}/{name}")
        if rank := row.get("ccf"):
            require(rank["grade"] in {"A", "B", "C", "not-listed"} and https_url(rank["url"]) and rank["version"], "Invalid CCF entry")
        if row.get("editor_in_chief") is not None:
            validate_editor(row["editor_in_chief"], key)
        if row.get("impact_factor") is not None:
            validate_impact(row["impact_factor"], key)
        for metric_key, metric in row.get("details", {}).items():
            require(bool(metric["value"]) and https_url(metric["url"]), "Unsourced detail")
            date.fromisoformat(metric["checked_at"])
            if metric_key == "length":
                for stage in ("initial", "revised"):
                    if stage in metric:
                        limit = metric[stage]
                        require(isinstance(limit, dict) and all(isinstance(limit.get(lang), str) and limit[lang].strip()
                                                              for lang in ("en", "zh")), f"Invalid {stage} submission limit: {key}")
    return ids


def validate_snapshot(snapshot):
    require(snapshot["version"] == 1, "Unrecognized snapshot version")
    if checked := snapshot.get("cfp_checked_at"):
        require(datetime.fromisoformat(checked).utcoffset() is not None, "CFP check time must include a timezone")
    ids = validate_registry(snapshot["journals"])
    calls = snapshot["calls"]
    require(isinstance(calls, dict), "Invalid CFP map")
    for key, call in calls.items():
        require(SLUG.fullmatch(key) and call["id"] == key and call["journal_id"] in ids, "Invalid CFP identity")
        require(https_url(call["url"]) and call["title"].strip(), "Invalid CFP source")
        require(call["status"] in {"closed", "dated", "ongoing", "unknown"}, "Invalid CFP status")
        if call["deadline"]:
            date.fromisoformat(call["deadline"])
        require(call["status"] != "dated" or bool(call["deadline"]), "Dated CFP missing deadline")
        require(not call.get("deadline_source") or https_url(call["deadline_source"]), "Invalid CFP deadline source")
    for key, stat in snapshot["stats"].items():
        require(key in ids, "Unknown journal in statistics")
        for year, count in stat.get("counts", {}).items():
            require(re.fullmatch(r"\d{4}", year) and type(count) is int and count >= 0, "Invalid annual count")
    require(set(snapshot["cfp_sources"]).issubset(ids), "Unknown CFP source")


def apply_journal_overrides(journals, overrides):
    rows = deepcopy(journals)
    for item in rows:
        update = overrides.get(item["id"], {})
        require(not ({"id", "issn", "previous_issns"} & update.keys()), "Override cannot modify identity")
        if "details" in update:
            update = {**update, "details": {**item.get("details", {}), **update["details"]}}
        item.update(update)
    return rows


def sync_metadata(registry, overrides, snapshot):
    """Apply registry metadata without fetching or replacing CFPs or annual counts."""
    validate_snapshot(snapshot)
    journals = apply_journal_overrides(registry, overrides.get("journals", {}))
    ids = validate_registry(journals)
    previous = {row["id"]: row for row in snapshot["journals"]}
    require(ids == set(previous), "Metadata update cannot add or remove journals")
    for row in journals:
        old = previous[row["id"]]
        require(all(row.get(key) == old.get(key) for key in ("issn", "previous_issns")),
                f"Metadata update cannot change journal identity: {row['id']}")
        if issn_l := snapshot["stats"].get(row["id"], {}).get("issn_l") or old.get("issn_l"):
            row["issn_l"] = issn_l
    updated = {**snapshot, "journals": journals}
    validate_snapshot(updated)
    return updated


def apply_call_overrides(calls, overrides):
    for key, value in overrides.items():
        require(not ({"id", "journal_id", "history", "deadline_version"} & value.keys()), "Override cannot modify CFP identity/history")
        if key in calls:
            # Display-only overrides, applied after source merging to avoid false change events.
            calls[key] = {**calls[key], **value}
        else:
            require(value.get("journal_id") is None, "Use a publisher parser for new calls")
    return calls


def previous_snapshot(args):
    if args.seed:
        return None, True
    if args.previous_file:
        data = read_json(args.previous_file)
        validate_snapshot(data)
        return data, False
    try:
        data = json.loads(read_url(LIVE, {"ql-xun.github.io"}, accept="application/json"))
        validate_snapshot(data)
        return data, False
    except HTTPError as error:
        if error.code == 404 and args.bootstrap and args.output.is_file():
            # First deployment only: a fully checked-in seed permits bootstrap.
            data = read_json(args.output)
            validate_snapshot(data)
            require(any(source.get("checked_at") for source in data["cfp_sources"].values()) and
                    all(data["stats"].get(item["id"], {}).get("checked_at") for item in data["journals"]),
                    "Initial snapshot is incomplete")
            return data, True
        raise


def complete_cfp_check(journals, sources, previous, now):
    """Advance the public check time only after every supported directory succeeds."""
    supported = [row["id"] for row in journals if row.get("cfp_url") and parser_for(row["cfp_url"], row["id"])]
    stamp = now.isoformat()
    if supported and all(sources.get(key, {}).get("status") == "ok" and
                         sources[key].get("checked_at") == stamp for key in supported):
        return stamp
    return previous.get("cfp_checked_at")


def statistics_to_refresh(journals, stats, now, *, full=False, cfp_only=False):
    if cfp_only:
        return []
    return [row for row in journals if full or not stats.get(row["id"], {}).get("checked_at") or
            str(now.year) not in stats.get(row["id"], {}).get("counts", {})]


def refresh(args):
    now = datetime.now(SHANGHAI)
    registry = read_json(DATA / "registry.json")
    overrides = read_json(DATA / "overrides.json")
    journals = apply_journal_overrides(registry, overrides.get("journals", {}))
    ids = validate_registry(journals)
    previous, bootstrap = previous_snapshot(args)
    old = previous or {}
    calls = {key: deepcopy(call) for key, call in old.get("raw_calls", old.get("calls", {})).items() if call["journal_id"] in ids}
    stats = {key: value for key, value in old.get("stats", {}).items() if key in ids}
    sources = {}
    active_ids = set()
    cfp_sources = old.get("cfp_sources", {})
    with ThreadPoolExecutor(max_workers=5) as pool:
        jobs = [pool.submit(refresh_source, journal, cfp_sources.get(journal["id"], {}), calls.copy(), now) for journal in journals]
        for job in jobs:
            key, status, records = job.result()
            sources[key] = status
            if records is not None:
                active_ids |= merge_source(calls, key, records, now.isoformat())

    update = statistics_to_refresh(journals, stats, now, full=args.full, cfp_only=args.cfp_only)
    if update:
        issns = sorted({issn for item in update for issn in
                        [item["issn"], *(p["issn"] for p in item.get("previous_issns", []))]})
        try:
            mapping = resolve_sources(issns)
        except (ValueError, KeyError, OSError, TypeError) as error:
            mapping = {}
            print(f"OpenAlex source resolution: {error_summary(error)}", flush=True)
        with ThreadPoolExecutor(max_workers=2) as pool:
            for key, stat in pool.map(lambda item: annual_stats(item, mapping, stats.get(item["id"], {}), now), update):
                stats[key] = stat
                print(f"OpenAlex {key}: {stat['status']}", flush=True)
    if bootstrap and previous is None:
        require(any(value["status"] == "ok" for value in sources.values()) and
                all(stats.get(item["id"], {}).get("checked_at") for item in journals),
                "Cannot seed: CFP or OpenAlex baseline is incomplete")
    for journal in journals:
        value = stats.get(journal["id"], {}).get("issn_l")
        if value:
            journal["issn_l"] = value
    raw_calls = deepcopy(calls)
    apply_call_overrides(calls, overrides.get("calls", {}))
    seen, digest = create_digest(None if bootstrap else previous, calls, active_ids, now.date())
    snapshot = {"version": 1, "generated_at": now.isoformat(), "journals": journals, "calls": calls, "stats": stats,
                "cfp_sources": sources, "digest_seen": seen,
                "cfp_checked_at": complete_cfp_check(journals, sources, old, now)}
    if raw_calls != calls:
        snapshot["raw_calls"] = raw_calls
    validate_snapshot(snapshot)
    atomic_json(args.output, snapshot)
    if args.digest:
        # No mailbox or secrets are placed in the downloadable Actions artifact.
        args.digest.parent.mkdir(parents=True, exist_ok=True)
        args.digest.write_text(digest["subject"] + "\n\n" + digest["body"] if digest else
                               "No journal email generated for this run.\n", encoding="utf-8")
    print(f"Validated {len(journals)} journals, {len(calls)} CFPs, {len(stats)} statistics entries.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DATA / "snapshot.json")
    parser.add_argument("--previous-file", type=Path)
    parser.add_argument("--digest", type=Path)
    parser.add_argument("--seed", action="store_true", help="One-off initial baseline from live sources")
    parser.add_argument("--bootstrap", action="store_true", help="Allow the checked-in seed on the first deployment only")
    statistics = parser.add_mutually_exclusive_group()
    statistics.add_argument("--full", action="store_true", help="Refresh all OpenAlex counts explicitly")
    statistics.add_argument("--cfp-only", action="store_true", help="Refresh CFPs without requesting OpenAlex statistics")
    offline = parser.add_mutually_exclusive_group()
    offline.add_argument("--validate", action="store_true", help="Validate the supplied snapshot without network")
    offline.add_argument("--metadata-only", action="store_true", help="Sync only registry metadata into the existing output snapshot")
    args = parser.parse_args()
    if args.validate:
        validate_registry(read_json(DATA / "registry.json"))
        validate_snapshot(read_json(args.output))
    elif args.metadata_only:
        require(not (args.seed or args.full or args.cfp_only or args.bootstrap or args.previous_file or args.digest),
                "--metadata-only updates only the existing --output snapshot")
        updated = sync_metadata(read_json(DATA / "registry.json"), read_json(DATA / "overrides.json"), read_json(args.output))
        atomic_json(args.output, updated)
        print(f"Synced metadata for {len(updated['journals'])} journals; CFPs and statistics unchanged.", flush=True)
    else:
        refresh(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError) as error:
        print("Journal build halted:", error_summary(error), str(error) if isinstance(error, ValueError) else "", file=sys.stderr)
        sys.exit(1)
