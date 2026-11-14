"""Serve the static site locally with browser-compatible JavaScript MIME types."""

from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript"}


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("port", type=int, nargs="?", default=8080)
    port = parser.parse_args().port
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=root)) as server:
        print(f"Local: http://127.0.0.1:{port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
