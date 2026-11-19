from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

from serve_site import Handler, REVISION_PATH


class PreviewTests(unittest.TestCase):
    def test_preview_updates_revision_without_modifying_site_html(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            page = root / "index.html"
            html = "<body><h1>Test preview</h1></body>"
            page.write_text(html, encoding="utf-8")
            assets = root / "assets"
            assets.mkdir()
            sample = assets / "test.js"
            sample.write_text("export const value = 1;", encoding="utf-8")
            hidden = root / ".private"
            hidden.write_text("not served", encoding="utf-8")
            with ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=root)) as server:
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                base = f"http://127.0.0.1:{server.server_port}"
                try:
                    with urlopen(base + REVISION_PATH, timeout=3) as response:
                        previous = response.read()
                    with urlopen(base + "/", timeout=3) as response:
                        self.assertEqual(response.headers["Cache-Control"], "no-store")
                        self.assertIn(previous, response.read())
                    self.assertEqual(page.read_text(encoding="utf-8"), html)
                    sample.write_text("export const value = 100;", encoding="utf-8")
                    with urlopen(base + REVISION_PATH, timeout=3) as response:
                        self.assertNotEqual(previous, response.read())
                    with urlopen(base + "/assets/test.js", timeout=3) as response:
                        self.assertEqual(response.headers.get_content_type(), "text/javascript")
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base + "/.private", timeout=3)
                    self.assertEqual(error.exception.code, 404)
                finally:
                    server.shutdown()
                    worker.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
