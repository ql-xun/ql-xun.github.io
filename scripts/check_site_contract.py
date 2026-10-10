"""Validate permanent public URLs and homepage invariants before deployment."""

import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]


def require_file(relative_path: str) -> str:
    path = ROOT / relative_path
    if not path.is_file():
        raise AssertionError(f"Required public path is missing: {relative_path}")
    return path.read_text(encoding="utf-8", errors="strict") if path.suffix != ".pdf" else ""


def require_text(content: str, expected: str, label: str) -> None:
    if expected not in content:
        raise AssertionError(f"Required content is missing from {label}: {expected}")


def require_absent(relative_path: str) -> None:
    if (ROOT / relative_path).exists():
        raise AssertionError(f"Removed template asset has returned: {relative_path}")


def require_json_array(relative_path: str) -> list[dict]:
    content = require_file(relative_path)
    try:
        data = json.loads(content)
    except json.JSONDecodeError as error:
        raise AssertionError(f"Invalid JSON in {relative_path}: {error}") from error
    if not isinstance(data, list):
        raise AssertionError(f"{relative_path} must contain a JSON array")
    if not all(isinstance(item, dict) for item in data):
        raise AssertionError(f"Every item in {relative_path} must be a JSON object")
    return data


def require_bilingual(value: object, label: str) -> None:
    if not isinstance(value, dict):
        raise AssertionError(f"{label} must be an object with en and zh fields")
    for language in ("en", "zh"):
        text = value.get(language)
        if not isinstance(text, str) or not text.strip():
            raise AssertionError(f"{label}.{language} must be non-empty text")


def validate_optional_media_and_link(item: dict, label: str, check_image: bool) -> None:
    image = item.get("image", "")
    if not isinstance(image, str):
        raise AssertionError(f"{label}.image must be text")
    if image:
        require_bilingual(item.get("image_alt"), f"{label}.image_alt")
        if check_image:
            image_path = (ROOT / image).resolve()
            if ROOT.resolve() not in image_path.parents or not image_path.is_file():
                raise AssertionError(f"{label}.image does not point to a repository file: {image}")

    link = item.get("link", {})
    if not isinstance(link, dict):
        raise AssertionError(f"{label}.link must be an object")
    url = link.get("url", "")
    if not isinstance(url, str):
        raise AssertionError(f"{label}.link.url must be text")
    if url:
        require_bilingual(link.get("label"), f"{label}.link.label")


def validate_gallery(item: dict, label: str, check_images: bool) -> None:
    gallery = item.get("gallery", [])
    if not isinstance(gallery, list):
        raise AssertionError(f"{label}.gallery must be an array")

    for place_index, place in enumerate(gallery):
        place_label = f"{label}.gallery[{place_index}]"
        if not isinstance(place, dict):
            raise AssertionError(f"{place_label} must be an object")
        require_bilingual(place.get("location"), f"{place_label}.location")
        year = place.get("year", "")
        if year and (not isinstance(year, str) or not re.fullmatch(r"\d{4}", year)):
            raise AssertionError(f"{place_label}.year must use YYYY")

        photos = place.get("photos")
        if not isinstance(photos, list) or not photos:
            raise AssertionError(f"{place_label}.photos must be a non-empty array")
        for photo_index, photo in enumerate(photos):
            photo_label = f"{place_label}.photos[{photo_index}]"
            if not isinstance(photo, dict):
                raise AssertionError(f"{photo_label} must be an object")
            src = photo.get("src")
            if not isinstance(src, str) or not src:
                raise AssertionError(f"{photo_label}.src must be non-empty text")
            require_bilingual(photo.get("alt"), f"{photo_label}.alt")
            orientation = photo.get("orientation", "standard")
            if orientation not in ("standard", "wide", "portrait"):
                raise AssertionError(
                    f"{photo_label}.orientation must be standard, wide, or portrait"
                )
            if check_images:
                image_path = (ROOT / src).resolve()
                if ROOT.resolve() not in image_path.parents or not image_path.is_file():
                    raise AssertionError(
                        f"{photo_label}.src does not point to a repository file: {src}"
                    )


def validate_hobbies(items: list[dict], label: str, check_images: bool) -> None:
    for index, item in enumerate(items):
        item_label = f"{label}[{index}]"
        require_bilingual(item.get("title"), f"{item_label}.title")
        require_bilingual(item.get("description"), f"{item_label}.description")
        validate_optional_media_and_link(item, item_label, check_images)
        validate_gallery(item, item_label, check_images)


def validate_thoughts(items: list[dict], label: str, check_images: bool) -> None:
    for index, item in enumerate(items):
        item_label = f"{label}[{index}]"
        date = item.get("date")
        if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            raise AssertionError(f"{item_label}.date must use YYYY-MM-DD")
        require_bilingual(item.get("title"), f"{item_label}.title")
        require_bilingual(item.get("body"), f"{item_label}.body")
        validate_optional_media_and_link(item, item_label, check_images)


def require_order(content: str, markers: list[str], label: str) -> None:
    positions = [content.find(marker) for marker in markers]
    if -1 in positions or positions != sorted(positions):
        raise AssertionError(f"Required ordering is incorrect in {label}: {' -> '.join(markers)}")


def main() -> int:
    homepage = require_file("index.html")
    hobbies_page = require_file("hobbies.html")
    thoughts_page = require_file("thoughts.html")
    stylesheet = require_file("assets/css/site.css")
    script = require_file("assets/js/site.js")
    require_file("assets/favicon.svg")
    speed_detector = require_file("speeddetector/index.html")
    iscc_page = require_file("papers/xun2026efficient/index.html")
    robots = require_file("robots.txt")
    sitemap = require_file("sitemap.xml")
    google_verification = require_file("googleceb99c875e0d20ae.html")
    legacy_google_verification = require_file("google6e027989c2c8311c.html")
    require_file("papers/files/xun2026efficient-iscc-accepted-2026-04.pdf")
    hobbies = require_json_array("content/hobbies.json")
    thoughts = require_json_array("content/thoughts.json")
    hobby_example = require_json_array("content/examples/hobbies.example.json")
    thought_example = require_json_array("content/examples/thoughts.example.json")

    validate_hobbies(hobbies, "content/hobbies.json", check_images=True)
    validate_thoughts(thoughts, "content/thoughts.json", check_images=True)
    validate_hobbies(hobby_example, "content/examples/hobbies.example.json", check_images=False)
    validate_thoughts(thought_example, "content/examples/thoughts.example.json", check_images=False)

    require_text(speed_detector, "https://gist.github.com/a6d2106a840433eefcb42edc29fe9d27", "speeddetector/index.html")
    require_text(iscc_page, "/papers/files/xun2026efficient-iscc-accepted-2026-04.pdf", "papers/xun2026efficient/index.html")
    require_text(homepage, "/papers/xun2026efficient/", "index.html")
    require_text(homepage, "10.1109/TCOMM.2026.3738510", "index.html")
    require_text(homepage, "data-lang=\"en\"", "index.html")
    require_text(homepage, "Pengcheng Laboratory", "index.html")
    require_text(homepage, "张金钡教授", "index.html")
    require_text(homepage, "xunqlin@mail2.sysu.edu.cn", "index.html")
    require_text(homepage, "xunql2023@gmail.com", "index.html")
    require_text(homepage, "assets/css/site.css", "index.html")
    require_text(homepage, "assets/js/site.js", "index.html")
    for page_content, page_label in (
        (homepage, "index.html"),
        (hobbies_page, "hobbies.html"),
        (thoughts_page, "thoughts.html"),
    ):
        require_text(page_content, "assets/css/site.css?v=20261011-2", page_label)
        require_text(page_content, "assets/js/site.js?v=20261011-2", page_label)
    require_text(homepage, 'href="hobbies.html"', "index.html")
    require_text(homepage, 'href="thoughts.html"', "index.html")
    require_text(hobbies_page, 'id="hobbiesContent"', "hobbies.html")
    require_text(hobbies_page, 'data-page="hobbies"', "hobbies.html")
    require_text(thoughts_page, 'id="thoughtsContent"', "thoughts.html")
    require_text(thoughts_page, 'data-page="thoughts"', "thoughts.html")
    require_text(script, 'content/hobbies.json', "assets/js/site.js")
    require_text(script, 'content/thoughts.json', "assets/js/site.js")
    require_text(script, "appendGallery", "assets/js/site.js")
    require_text(script, 'bilingualElement("figcaption", "hobby-photo-caption"', "assets/js/site.js")
    require_text(stylesheet, ".content-state", "assets/css/site.css")
    require_text(stylesheet, ".hobby-photo-grid", "assets/css/site.css")
    require_text(stylesheet, "width: min(1170px, calc(100% - 38px));", "assets/css/site.css")
    require_text(robots, "Allow: /", "robots.txt")
    require_text(robots, "Sitemap: https://ql-xun.github.io/sitemap.xml", "robots.txt")
    require_text(sitemap, "<loc>https://ql-xun.github.io/</loc>", "sitemap.xml")
    require_text(sitemap, "<loc>https://ql-xun.github.io/hobbies.html</loc>", "sitemap.xml")
    require_text(sitemap, "<loc>https://ql-xun.github.io/thoughts.html</loc>", "sitemap.xml")
    require_text(
        google_verification,
        "google-site-verification: googleceb99c875e0d20ae.html",
        "googleceb99c875e0d20ae.html",
    )
    require_text(
        legacy_google_verification,
        "google-site-verification: google6e027989c2c8311c.html",
        "google6e027989c2c8311c.html",
    )
    require_order(
        homepage,
        [
            "10.1109/TON.2025.3570008",
            "10.1109/TCOMM.2026.3738510",
            "10.1109/IWQoS57198.2023.10188787",
            "/papers/xun2026efficient/",
        ],
        "index.html",
    )

    if "<style>" in homepage:
        raise AssertionError("Homepage styles must remain in assets/css/site.css")
    if 'id="hobbiesContent"' in homepage or 'id="thoughtsContent"' in homepage:
        raise AssertionError("Hobbies and Thoughts must remain on standalone pages")
    if "Beyond research" in homepage or "Notes in progress" in homepage:
        raise AssertionError("Generic placeholder content must not return to the homepage")

    for removed_asset in (
        "stylesheet.css",
        "font-awesome.min.css",
        "w3.css",
        "jquery.min.js",
        "jquery-1.11.1.min.js",
        "data/CV_Qinglin.pdf",
        "images/AdderNet.jpg",
        "images/atlas200.PNG",
        "images/GhostNet.png",
        "images/HDC2020-small.gif",
        "images/Qinglin.jpg",
        "images/video.gif",
        "images/Yunhe_new.jpg",
        "images/YunheWang_circle.jpg",
        "images/icons.png",
        "images/icon/cursor.png",
        "images/icon/cursor-pointer.png",
        "images/experience/background-960.webp",
        "images/experience/background-1440.webp",
        "images/experience/background-1920.webp",
        "images/experience/background.jpeg",
    ):
        require_absent(removed_asset)

    print("Site contract passed: permanent URLs, content data, and homepage invariants are intact.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"Site contract failed: {error}", file=sys.stderr)
        raise SystemExit(1)
