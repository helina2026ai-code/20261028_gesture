"""Regression tests for the missing CSS/JS caused by opening the wrong URL."""

import socket
import subprocess
import sys
import time
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urljoin
from urllib.request import urlopen


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "link" and attrs.get("rel") == "stylesheet":
            self.paths.append(attrs["href"])
        if tag in {"script", "img"} and "src" in attrs:
            self.paths.append(attrs["src"])


class WebStartupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base_url = f"http://127.0.0.1:{port}"
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=Path(__file__).resolve().parents[1],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        cls.addClassCleanup(cls.stop_server)
        for _ in range(60):
            try:
                with urlopen(cls.base_url + "/health", timeout=1) as response:
                    if response.status == 200:
                        return
            except (URLError, TimeoutError):
                if cls.server.poll() is not None:
                    raise RuntimeError(cls.server.stderr.read().decode(errors="replace"))
                time.sleep(0.1)
        raise RuntimeError("Server did not start")

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        cls.server.communicate(timeout=10)

    def test_root_redirect_and_relative_assets(self):
        with urlopen(self.base_url + "/", timeout=3) as response:
            self.assertEqual(response.geturl(), self.base_url + "/static/index.html")
            html_url = response.geturl()
            parser = AssetParser()
            parser.feed(response.read().decode("utf-8"))
        self.assertEqual(len(parser.paths), 3)
        for asset in parser.paths:
            with self.subTest(asset=asset), urlopen(urljoin(html_url, asset), timeout=3) as response:
                self.assertEqual(response.status, 200)
                self.assertGreater(len(response.read()), 0)

    def test_modules_have_javascript_content_type(self):
        for asset in ["app.js", "gallery.mjs", "gesture-controller.mjs", "hand-flip-controller.mjs", "fist-controller.mjs", "two-hand-controller.mjs", "bootstrap.js"]:
            with self.subTest(asset=asset), urlopen(self.base_url + "/static/" + asset, timeout=3) as response:
                self.assertIn("javascript", response.headers["Content-Type"])


if __name__ == "__main__":
    unittest.main()
