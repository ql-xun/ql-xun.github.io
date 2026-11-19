import copy
from datetime import date, datetime
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from journal_cfp import deadline_date, detail_fields, parse_page, pdf_fields
from journal_digest import create_digest, deliver
from refresh_journals import (
    annual_stats, complete_cfp_check, merge_source, read_json, read_url, refresh_source, statistics_to_refresh,
    sync_metadata, validate_editor, validate_impact, validate_snapshot,
)


DATE = "2026-11-14T08:17:00+08:00"
NOW = datetime.fromisoformat(DATE)
URL = "https://www.comsoc.org/publications/journals/ieee-jsac/cfp"
TABLE = """<main><table><thead><tr><th>Paper Topic</th><th>Publication Date</th>
<th>Manuscript Submission Deadline</th></tr></thead><tbody>
<tr><td><a href="/cfp/example">An example CFP</a></td><td>March 2027</td><td>21 November 2026</td></tr>
<tr><td><a href="/cfp/closed">Past CFP</a></td><td>2025</td><td>Closed</td></tr>
<tr><td><a href="/cfp/unclear">Date to come</a></td><td></td><td>November 2026</td></tr>
</tbody></table></main>"""
CS_URL = "https://www.computer.org/publications/author-resources/calls-for-papers"
CS_DIR = """<main><h1>Calls for Papers in Computer Science</h1>
<div><div><a href="/digital-library/journals/tq/cfp-agentic-systems">CFP: Special Issue on Agentic Systems</a></div>
Submission deadline: 4 January 2027</div>
<div><div><a href="/digital-library/journals/ta/tac-gen-ai">Call for Papers: Special Issue on Affective Computing</a></div>
Submissions due: 30 January 2027</div>
<div><div><a href="/digital-library/journals/ec/cfp-dependable">CFP: Special Section on Dependable Computing</a></div>
Deadline for submissions: 10 November 2026</div>
<div><div><a href="/digital-library/journals/ta/tac-general-call-for-papers">General call for papers</a></div></div></main>"""
TNET_URL = "https://www.comsoc.org/publications/journals/ieee-tnet/ieee-transactions-networking-call-papers"
SCIS_URL = "https://scis.scichina.com/"
SPS_URL = "https://signalprocessingsociety.org/event-categories/special-issue-deadlines"


class CFPTests(unittest.TestCase):
    @patch("refresh_journals.time.sleep")
    @patch("refresh_journals.build_opener")
    def test_truncated_http_body_is_retried_not_parsed_as_a_partial_directory(self, opener, _):
        response = opener.return_value.open.return_value.__enter__.return_value
        response.headers = {"Content-Length": "8"}
        response.read.side_effect = [b"short", b"complete"]
        self.assertEqual(read_url(URL, {"www.comsoc.org"}), b"complete")
        response.read.side_effect = [b"short", b"short"]
        with self.assertRaises(URLError):
            read_url(URL, {"www.comsoc.org"})

    def test_parser_does_not_invent_deadline(self):
        first, closed, unknown = parse_page(TABLE, URL, "jsac")
        self.assertEqual(first["deadline"], "2026-11-21")
        self.assertEqual(first["publication"], "March 2027")
        self.assertEqual(closed["status"], "closed")
        self.assertEqual(unknown["status"], "unknown")
        self.assertIsNone(unknown["deadline"])
        self.assertIsNone(deadline_date("31 February 2026"))
        self.assertEqual(deadline_date("June 15th, 2027"), "2027-06-15")

    def test_publisher_pdf_only_reads_labeled_dates(self):
        result = pdf_fields("Important Dates\nManuscript submission deadline: December 15, 2026\n"
                            "Publication date: August 2027\nGuest Editors\n A. Editor, University\n")
        self.assertEqual(result, (["A. Editor"], "2026-12-15", "August 2027"))

    def test_parser_refuses_unrecognized_markup(self):
        with self.assertRaises(ValueError):
            parse_page("<html>Something else</html>", URL, "jsac")
        with self.assertRaises(ValueError):
            parse_page(TABLE.replace("/cfp/example", "https://unrelated.test/example"), URL, "jsac")
        self.assertEqual(parse_page("<main>No open calls for papers at this time</main>", URL, "jsac"), [])

    def test_editors_and_detail_date(self):
        fields = detail_fields("<main><p>Submission deadline: 21 November 2026</p>"
                               '<h2>Guest Editors</h2><p><a href="mailto:editor@example.org">A. Editor</a></p></main>')
        self.assertEqual(fields, (["A. Editor"], "2026-11-21"))

    def test_tnet_single_topic_tracks_submission_not_publication(self):
        [item] = parse_page("""<main><h2>IEEE Transactions on Networking Special Issue on AI and Networking</h2>
            <p>Manuscript Submission Deadline: 15 January 2025</p><p>Planned Publication: March 2026</p></main>""",
                            TNET_URL, "ton")
        self.assertEqual((item["journal_id"], item["url"], item["deadline"], item["publication"]),
                         ("ton", TNET_URL, "2025-01-15", "March 2026"))
        self.assertLess(date.fromisoformat(item["deadline"]), NOW.date())

    def test_computer_society_uses_journal_paths_not_title_keywords(self):
        for key, slug, date_text in [("tdsc", "cfp-agentic-systems", "2027-01-04"),
                                     ("taffc", "tac-gen-ai", "2027-01-30"),
                                     ("tetc", "cfp-dependable", "2026-11-10")]:
            with self.subTest(key=key):
                [item] = parse_page(CS_DIR, CS_URL, key)
                self.assertEqual(item["journal_id"], key)
                self.assertTrue(item["url"].endswith("/" + slug))
                self.assertEqual(item["deadline"], date_text)

    def test_detail_overrules_past_directory_date_and_survives_refresh_failure(self):
        detail = """<main></main><article class="general-post-content"></article>
            <article class="general-post-content"><div class="prose">
            <ul><li>Deadline for submissions: 15 February 2027</li>
            <li>Submission of revised papers: 20 April 2027</li></ul><b>Guest Editors:</b>
            <ul><li>Dr. Jane Researcher (Lead Guest Editor), Example University</li>
            <li><strong>John Scholar</strong>, Example University</li>
            <li>Corresponding TETC Editor: Morgan Editor, Example University</li></ul></div></article>"""
        journal = {"id": "tetc", "cfp_url": CS_URL}
        with patch("refresh_journals.read_url", side_effect=[CS_DIR, detail]):
            _, state, [item] = refresh_source(journal, {}, {}, NOW)
        self.assertEqual(state["status"], "ok")
        self.assertEqual(item["deadline"], "2027-02-15")
        self.assertEqual(item["deadline_source"], item["url"])
        self.assertEqual(item["editors"], ["Jane Researcher", "John Scholar"])
        with patch("refresh_journals.read_url", return_value=CS_DIR) as read:
            _, _, [cached] = refresh_source(journal, {}, {item["id"]: item}, NOW)
        self.assertEqual(read.call_count, 1)
        self.assertEqual(cached["deadline"], item["deadline"])
        later = datetime.fromisoformat("2026-11-22T08:17:00+08:00")
        with patch("refresh_journals.read_url", side_effect=[CS_DIR, URLError("offline")]):
            _, _, [cached] = refresh_source(journal, {}, {item["id"]: item}, later)
        self.assertEqual(cached["deadline"], item["deadline"])
        self.assertEqual(cached["editors"], item["editors"])
        self.assertTrue(cached["detail_stale"])
        no_initial_deadline = "<main><p>Final manuscript due: 10 March 2027</p><p>Revised manuscript due: 20 April 2027</p></main>"
        with patch("refresh_journals.read_url", side_effect=[CS_DIR, no_initial_deadline]):
            _, _, [unknown] = refresh_source(journal, {}, {}, NOW)
        self.assertEqual(unknown["status"], "unknown")
        self.assertIsNone(unknown["deadline"])

    def test_cs_detail_can_confirm_official_closure(self):
        detail = "<main><p>Submission deadline: Closed</p></main>"
        with patch("refresh_journals.read_url", side_effect=[CS_DIR, detail]):
            _, _, [item] = refresh_source({"id": "taffc", "cfp_url": CS_URL}, {}, {}, NOW)
        self.assertEqual(item["status"], "closed")
        self.assertIsNone(item["deadline"])

    def test_scis_section_ignores_ssi_and_published_topics(self):
        html = """<div><h4>Call For Papers / 征稿启事</h4><ul>
            <li>SCIS <a href="http://scis.scichina.com/cfp/scis2027-example.pdf">Special Topic: Distributed Learning (2026.11.30)</a></li>
            <li>SSI <a href="/cfp/ssi2027-example.pdf">中文专题 (2026.11.30)</a></li></ul>
            <h4>Special Topics</h4><ul><li>SCIS <a href="/cfp/scis2026-published.pdf">Published</a></li></ul></div>"""
        [item] = parse_page(html, SCIS_URL, "scis")
        self.assertEqual((item["url"], item["title"], item["deadline"]),
                         (SCIS_URL + "cfp/scis2027-example.pdf", "Special Topic: Distributed Learning", "2026-11-30"))
        with self.assertRaises(ValueError):
            parse_page(html.replace("http://scis.scichina.com", "https://unrelated.test"), SCIS_URL, "scis")
        self.assertEqual(parse_page(html.replace("SCIS <a href=", "SSI <a href=", 1), SCIS_URL, "scis"), [])

    def test_scis_pdf_names_support_wrapped_affiliations_and_chinese(self):
        fields = pdf_fields("Manuscript submission deadline: Nov. 30, 2026\r\nGuest Editors\r\n"
                            "曹志刚，北京交通大学\r\nXiang BAI (白翔), Huazhong University of Science and\r\n"
                            "Technology, China\r\nWei SHEN (沈为), Shanghai Jiao Tong University, China\r\n"
                            "Contact\r\nKai JIANG (蒋恺), Scientific Editor\r\n")
        self.assertEqual(fields, (["曹志刚", "Xiang BAI (白翔)", "Wei SHEN (沈为)"], "2026-11-30", None))

    def test_sps_only_parses_calls_with_matching_journal_identity(self):
        html = """<main><h1>Special Issue Deadlines</h1><div class="views-row">
            <article><h4><a href="/jstsp/topic">IEEE J-STSP Special Issue on Tensors</a></h4>
            <p>Submission deadline: 30 November 2026</p></article>
            <article><h4><a href="/tsp/topic">IEEE Transactions on Signal Processing Special Issue on Estimation</a></h4>
            <p>Manuscript due: 15 December 2026</p></article></div></main>"""
        for key, deadline in [("jstsp", "2026-11-30"), ("tsp", "2026-12-15")]:
            with self.subTest(key=key):
                [item] = parse_page(html, SPS_URL, key)
                self.assertIn("/" + key + "/", item["url"])
                self.assertEqual(item["deadline"], deadline)

    def test_deadline_change_disappearance_and_closure(self):
        item = parse_page(TABLE, URL, "jsac")[0]
        calls = {}
        merge_source(calls, "jsac", [item], DATE)
        key = item["id"]
        merge_source(calls, "jsac", [], DATE)
        self.assertFalse(calls[key]["listed"])
        self.assertEqual(calls[key]["deadline"], "2026-11-21")
        self.assertEqual(calls[key]["status"], "dated")
        merge_source(calls, "jsac", [{**item, "deadline": "2026-11-30"}], DATE)
        self.assertEqual(calls[key]["history"][-1]["kind"], "deadline")
        self.assertEqual(calls[key]["deadline_version"], 1)
        merge_source(calls, "jsac", [{**item, "deadline": None, "status": "closed"}], DATE)
        self.assertEqual(calls[key]["history"][-1]["kind"], "closed")
        self.assertEqual(calls[key]["deadline"], "2026-11-30")

    @patch("refresh_journals.read_url", side_effect=URLError("offline"))
    def test_fetch_failure_retains_previous_status_date(self, _):
        _, source, rows = refresh_source({"id": "jsac", "cfp_url": URL}, {"checked_at": DATE}, {}, NOW)
        self.assertEqual(source["status"], "error")
        self.assertEqual(source["checked_at"], DATE)
        self.assertIsNone(rows)


class ScheduleTests(unittest.TestCase):
    def test_check_timestamp_advances_only_after_all_supported_sources_succeed(self):
        journals = [{"id": "jsac", "cfp_url": URL}, {"id": "tcom"},
                    {"id": "ton", "cfp_url": TNET_URL}]
        sources = {key: {"status": "ok", "checked_at": DATE} for key in ("jsac", "ton")}
        previous = {"cfp_checked_at": "2026-11-13T08:00:00+08:00"}
        self.assertEqual(complete_cfp_check(journals, sources, previous, NOW), DATE)
        for failure in ({"status": "error", "checked_at": DATE}, {},
                        {"status": "ok", "checked_at": previous["cfp_checked_at"]}):
            self.assertEqual(complete_cfp_check(journals, {**sources, "ton": failure}, previous, NOW),
                             previous["cfp_checked_at"])
        self.assertIsNone(complete_cfp_check(journals, {}, {}, NOW))
        self.assertEqual(complete_cfp_check([], {}, previous, NOW), previous["cfp_checked_at"])

    def test_daily_cfp_only_never_requests_statistics_even_if_missing(self):
        journals = [{"id": "jsac"}]
        self.assertEqual(statistics_to_refresh(journals, {}, NOW, cfp_only=True), [])
        stats = {"jsac": {"checked_at": DATE, "counts": {"2026": 0}}}
        sunday = datetime.fromisoformat("2026-11-15T08:00:00+08:00")
        self.assertEqual(statistics_to_refresh(journals, stats, sunday), [])
        self.assertEqual(statistics_to_refresh(journals, stats, sunday, full=True), journals)
        self.assertEqual(statistics_to_refresh(journals, {}, sunday), journals)


class OpenAlexTests(unittest.TestCase):
    @patch("refresh_journals.openalex", side_effect=HTTPError("https://api.openalex.org/works", 429, "Limit", {}, None))
    def test_rate_limit_does_not_erase_last_count(self, _):
        cached = {"counts": {"2025": 19}, "checked_at": DATE}
        _, stats = annual_stats({"id": "jsac", "issn": "0000-0000"}, {"0000-0000": ("S12", "0000-0000")}, cached, NOW)
        self.assertEqual(stats, {**cached, "status": "error"})
        self.assertNotIn("2026", stats["counts"])

    @patch("refresh_journals.time.sleep")
    @patch("refresh_journals.openalex", return_value={"meta": {"count": 0}})
    def test_current_year_and_renamed_source(self, request, _):
        journal = {"id": "ton", "issn": "2998-4157", "previous_issns": [{"issn": "1063-6692", "through": 2024}]}
        mapping = {"2998-4157": ("S20", "2998-4157"), "1063-6692": ("S10", "1063-6692")}
        _, stats = annual_stats(journal, mapping, {}, NOW)
        self.assertEqual(stats["counts"]["2026"], 0)
        self.assertEqual(stats["year_sources"]["2024"], "S10")
        self.assertEqual(stats["year_sources"]["2025"], "S20")
        self.assertIn("type:article|review", request.call_args.args[1]["filter"])

    def test_seed_snapshot(self):
        path = Path(__file__).resolve().parents[1] / "tools/journals/snapshot.json"
        data = read_json(path)
        validate_snapshot(data)
        self.assertGreaterEqual(len(data["journals"]), 33)
        self.assertEqual(set(data["stats"]), {item["id"] for item in data["journals"]})
        self.assertTrue(any(source["status"] == "ok" for source in data["cfp_sources"].values()))


class EditorTests(unittest.TestCase):
    def test_editor_validation_preserves_date_precision(self):
        editor = {"name": "A. Editor", "source": "https://example.org/board"}
        validate_editor(editor, "journal")
        for since in ("2026", "2026-08", "2026-08-01"):
            validate_editor({**editor, "since": since, "since_source": editor["source"]}, "journal")
        with self.assertRaises(ValueError):
            validate_editor({**editor, "since": "2026-08"}, "journal")
        with self.assertRaises(ValueError):
            validate_editor({**editor, "next": {**editor, "since": "2027", "since_source": editor["source"]}}, "journal")

    def test_co_editors_keep_independent_sources_and_dates(self):
        first = {"name": "A. Editor", "source": "https://example.org/board"}
        second = {"name": "B. Editor", "source": "https://example.org/board-2",
                  "since": "2025-08", "since_source": "https://example.org/appointment"}
        validate_editor({**first, "co_editors": [second]}, "journal")
        with self.assertRaises(ValueError):
            validate_editor({**first, "co_editors": [second, second]}, "journal")


class MetadataTests(unittest.TestCase):
    def test_impact_requires_public_source_and_valid_value(self):
        field = {"value": 7.5, "year": 2025, "url": "https://example.org/jif", "checked_at": "2026-11-16"}
        validate_impact(field, "journal")
        validate_impact({**field, "year": None}, "journal")
        for change in [{"url": "http://example.org"}, {"value": float("nan")}, {"value": True}, {"year": 2027}]:
            with self.assertRaises(ValueError):
                validate_impact({**field, **change}, "journal")

    def test_metadata_sync_preserves_all_cfp_and_stats_state(self):
        data = Path(__file__).resolve().parents[1] / "tools/journals"
        snapshot = read_json(data / "snapshot.json")
        registry = read_json(data / "registry.json")
        name = "Updated journal name"
        item = registry[0]
        result = sync_metadata(registry, {"journals": {item["id"]: {"name": name}}}, snapshot)
        self.assertEqual(result["journals"][0]["name"], name)
        self.assertEqual(result["journals"][0]["issn_l"], snapshot["journals"][0]["issn_l"])
        self.assertEqual({k: v for k, v in result.items() if k != "journals"},
                         {k: v for k, v in snapshot.items() if k != "journals"})
        self.assertNotEqual(registry[0]["name"], name)
        with self.assertRaises(ValueError):
            sync_metadata(registry[1:], {}, snapshot)


class DigestTests(unittest.TestCase):
    def setUp(self):
        self.item = parse_page(TABLE, URL, "jsac")[0]
        self.calls = {}
        self.ids = merge_source(self.calls, "jsac", [self.item], DATE)

    def test_first_baseline_is_silent(self):
        seen, digest = create_digest(None, self.calls, self.ids, date(2026, 11, 14))
        self.assertIsNone(digest)
        self.assertTrue(seen)

    def test_deadline_update_and_repeat(self):
        old = {"calls": copy.deepcopy(self.calls), "cfp_sources": {"jsac": {"checked_at": DATE}}, "digest_seen": {}}
        ids = merge_source(self.calls, "jsac", [{**self.item, "deadline": "2026-11-28"}], DATE)
        seen, digest = create_digest(old, self.calls, ids, date(2026, 11, 14))
        self.assertIn("2026-11-21 → 2026-11-28", digest["body"])
        self.assertIn("14 天", digest["body"])
        self.assertNotIn("@", digest["body"])
        old["digest_seen"] = seen
        self.assertIsNone(create_digest(old, self.calls, ids, date(2026, 11, 14))[1])
        self.assertIsNotNone(create_digest({**old, "calls": self.calls}, self.calls, ids, date(2026, 11, 21))[1])

    def test_no_transport_default(self):
        def never(*_):
            self.fail("Transport must not be called")
        self.assertFalse(deliver({"subject": "Test", "body": "Test"}, recipient="placeholder", transport=never))


if __name__ == "__main__":
    unittest.main()
