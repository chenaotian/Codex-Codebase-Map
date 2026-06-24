from __future__ import annotations

import argparse
import contextlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import time


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import sync_docs


class NoCacheRequestHandler(SimpleHTTPRequestHandler):
    sync_lock = threading.Lock()
    last_sync_at = 0.0

    def sync_sources(self) -> None:
        now = time.monotonic()
        with self.sync_lock:
            if now - self.last_sync_at < 0.25:
                return

            try:
                with contextlib.redirect_stdout(sys.stderr):
                    sync_docs.main()
                type(self).last_sync_at = now
            except Exception as exc:  # pragma: no cover - keep local serving alive.
                print(f"[sync warning] {exc}", file=sys.stderr)

    def do_GET(self) -> None:
        self.sync_sources()
        super().do_GET()

    def do_HEAD(self) -> None:
        self.sync_sources()
        super().do_HEAD()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the blog locally without browser caching.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--directory", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()

    handler = partial(NoCacheRequestHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"Serving no-cache blog at http://{args.bind}:{args.port}/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
