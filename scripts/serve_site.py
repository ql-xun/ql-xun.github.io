"""Serve this checkout on loopback and reload open preview pages after saves."""

from argparse import ArgumentParser
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit


SITE_ROOT = Path(__file__).resolve().parents[1]
WATCH_FOLDERS = ("assets", "content", "tools", "images", "papers", "cv", "speeddetector")
WATCH_EXTENSIONS = {
    ".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg", ".jpeg",
    ".webp", ".gif", ".ico", ".avif", ".pdf", ".xml", ".txt", ".woff", ".woff2",
}
REVISION_PATH = "/__local_preview/revision"


def site_revision(root):
    """Fingerprint served files without hashing large photos or PDFs."""
    entries = set(root.glob("*"))
    for folder in WATCH_FOLDERS:
        entries.update((root / folder).rglob("*"))
    stamp = hashlib.sha256()
    for path in sorted(entries):
        if path.suffix.lower() not in WATCH_EXTENSIONS or path.is_symlink():
            continue
        try:
            meta = path.stat()
        except FileNotFoundError:
            continue  # An editor can replace a file while the watcher is reading it.
        stamp.update(f"{path.relative_to(root)}:{meta.st_mtime_ns}:{meta.st_size}\n".encode("utf-8"))
    return stamp.hexdigest()


def reload_script(revision):
    return f"""
<script>
(() => {{
  const revision = "{revision}";
  async function check() {{
    try {{
      const response = await fetch("{REVISION_PATH}", {{ cache: "no-store" }});
      if (response.ok && (await response.text()).trim() !== revision) {{
        window.location.reload();
        return;
      }}
    }} catch (_) {{
      // Keep the preview open while its local server is restarting.
    }}
    window.setTimeout(check, 1500);
  }}
  window.setTimeout(check, 1500);
}})();
</script>
""".encode("utf-8")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_request(self, code="-", size="-"):
        if urlsplit(self.path).path != REVISION_PATH:
            super().log_request(code, size)

    def send_content(self, content, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        return BytesIO(content)

    def send_head(self):
        path = urlsplit(self.path).path
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            self.send_error(403, "Use the local preview URL")
            return None
        # The preview serves the checkout, but no Git metadata or hidden files.
        root = Path(self.directory).resolve()
        target = Path(self.translate_path(self.path)).resolve()
        if not target.is_relative_to(root) or any(part.startswith(".") for part in target.relative_to(root).parts):
            self.send_error(404)
            return None
        if path == REVISION_PATH:
            return self.send_content(site_revision(root).encode("ascii"), "text/plain; charset=utf-8")
        if target.is_dir() and path.endswith("/"):
            target = target / "index.html"
        if target.suffix.lower() == ".html" and target.is_file():
            page = target.read_bytes()
            script = reload_script(site_revision(root))
            close_body = page.lower().rfind(b"</body>")
            if close_body == -1:
                page += script
            else:
                page = page[:close_body] + script + page[close_body:]
            return self.send_content(page, "text/html; charset=utf-8")
        return super().send_head()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("port", type=int, nargs="?", default=8080)
    port = parser.parse_args().port
    with ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=SITE_ROOT)) as server:
        print(f"Local (auto-refresh): http://127.0.0.1:{server.server_port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
