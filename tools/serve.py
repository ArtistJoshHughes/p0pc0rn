#!/usr/bin/env python3
"""serve.py - a tiny static server for p0pc0rn (Python 3.8+, standard library only).

Serves the app's files to YOU and nobody else:

    python3 tools/serve.py                 # http://127.0.0.1:8080/ , the repository root
    tailscale serve --bg 8080              # then: https://<this-computer>.<your-tailnet>.ts.net/ (your tailnet only)

Why a server at all: WebGPU and the phone's private file storage (OPFS) only work in a secure context, i.e. https:// or
http://127.0.0.1 / localhost. `tailscale serve` adds the HTTPS in front of this server and keeps it inside your own tailnet.

What it does:
- binds to 127.0.0.1 by default, so only this computer (and `tailscale serve` on it) can reach it;
- sends the right types for the app's files (.js/.mjs, .wasm, .json, .webmanifest, .wgsl, model shards);
- `Cache-Control: no-cache` on index.html and every file without a content hash in its name (the browser re-checks
  them, so an update is never half old, half new); long-lived caching only for hashed files (name.0123abcd.js);
- supports byte ranges (Safari needs them to play video and audio files);
- never lists folders and never serves dotfiles (.git, .env, ...).

p0pc0rn's licence lets you run it only for yourself. Do not bind it to a LAN/public address, forward ports to it, or put a
public tunnel (tailscale funnel, ngrok, cloudflared, ...) in front of it.
"""
import argparse
import datetime
import email.utils
import http.server
import ipaddress
import os
import posixpath
import re
import sys
import urllib.parse
from functools import partial
from pathlib import Path

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".wasm": "application/wasm",
    ".wgsl": "text/wgsl; charset=utf-8",
    ".md": "text/plain; charset=utf-8",      # plain text, so Safari shows the licence files instead of downloading them
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".gz": "application/gzip",               # never Content-Encoding: the app inflates .gz files itself
    ".pfw": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".safetensors": "application/octet-stream",
    ".onnx": "application/octet-stream",
    ".tflite": "application/octet-stream",
    ".task": "application/octet-stream",
}
HASHED = re.compile(r"[.-][0-9a-f]{8,}\.[A-Za-z0-9]+$")   # app.3f9c2a1b.js, shard-0a1b2c3d4e.pfw
RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "p0pc0rn-serve"
    sys_version = ""
    protocol_version = "HTTP/1.1"             # keep-alive: the app is ~100 small ES modules
    quiet = False

    # -- paths ---------------------------------------------------------------------------------------------------------
    def _blocked(self):
        """dotfiles / dot-folders anywhere in the path (.git, .env, .ssh ...) are never served"""
        parts = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)).split("/")
        return any(p.startswith(".") and p not in (".", "") for p in parts)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return TYPES.get(ext) or super().guess_type(path) or "application/octet-stream"

    def list_directory(self, path):          # no folder listings
        self.send_error(404, "Not found")
        return None

    # -- headers -------------------------------------------------------------------------------------------------------
    def _cache_control(self, fs_path):
        name = os.path.basename(fs_path)
        if name == "index.html" or not HASHED.search(name):
            return "no-cache"                 # revalidate every time (Last-Modified / If-Modified-Since)
        return "public, max-age=31536000, immutable"

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    # -- GET / HEAD with Cache-Control and single byte ranges -----------------------------------------------------------
    def send_head(self):
        if self._blocked():
            self.send_error(404, "Not found")
            return None
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            if not self.path.split("?", 1)[0].endswith("/"):
                return super().send_head()    # the standard 301 to the trailing-slash URL
            path = os.path.join(path, "index.html")
            if not os.path.isfile(path):
                self.send_error(404, "Not found")
                return None
        if not os.path.isfile(path):
            self.send_error(404, "Not found")
            return None
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "Not found")
            return None
        try:
            st = os.fstat(f.fileno())
            size, mtime = st.st_size, st.st_mtime
            ims = self.headers.get("If-Modified-Since")
            if ims and not self.headers.get("If-None-Match") and not self.headers.get("Range"):
                try:
                    when = email.utils.parsedate_to_datetime(ims)
                    if when.tzinfo is None:
                        when = when.replace(tzinfo=datetime.timezone.utc)
                    if int(mtime) <= when.timestamp():
                        self.send_response(304)
                        self.send_header("Cache-Control", self._cache_control(path))
                        self.end_headers()
                        f.close()
                        return None
                except (TypeError, ValueError, IndexError, OverflowError):
                    pass
            start, end = 0, size - 1
            rng = self.headers.get("Range")
            m = RANGE.match(rng.strip()) if rng else None
            if rng and m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
                else:                                   # bytes=-N: the last N bytes
                    start = max(0, size - int(m.group(2)))
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % size)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    f.close()
                    return None
                self.send_response(206)
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
            else:
                self.send_response(200)
            length = end - start + 1
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Length", str(length))
            self.send_header("Last-Modified", self.date_time_string(int(mtime)))
            self.send_header("Cache-Control", self._cache_control(path))
            self.end_headers()
            f.seek(start)
            self._remaining = length
            return f
        except Exception:
            f.close()
            raise

    def copyfile(self, source, outputfile):
        left = getattr(self, "_remaining", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(1 << 20, left))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)

    def log_message(self, fmt, *args):
        if not self.quiet:
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


def default_root():
    here = Path(__file__).resolve().parent
    for cand in (here, here.parent, Path.cwd()):
        if (cand / "index.html").is_file():
            return cand
    return Path.cwd()


def is_loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def main(argv=None):
    ap = argparse.ArgumentParser(description="Serve p0pc0rn to yourself (put `tailscale serve` in front for your phone).")
    ap.add_argument("--root", type=Path, default=None, help="folder that holds index.html (default: the repository root)")
    ap.add_argument("--host", default="127.0.0.1", help="address to bind (default 127.0.0.1; anything else shows a warning)")
    ap.add_argument("--port", type=int, default=8080, help="port (default 8080)")
    ap.add_argument("--quiet", action="store_true", help="do not log each request")
    a = ap.parse_args(argv)

    root = (a.root or default_root()).resolve()
    if not root.is_dir():
        ap.error("--root %s is not a folder" % root)
    if not (root / "index.html").is_file():
        print("warning: %s has no index.html" % root, file=sys.stderr)
    if not is_loopback(a.host):
        print("\nWARNING: binding to %s lets OTHER devices on this network reach p0pc0rn.\n"
              "  The p0pc0rn licence lets you run it only for yourself, and phones need HTTPS anyway.\n"
              "  Use the default (127.0.0.1) and put `tailscale serve` in front of it instead.\n" % a.host, file=sys.stderr)

    Handler.quiet = a.quiet
    srv = http.server.ThreadingHTTPServer((a.host, a.port), partial(Handler, directory=str(root)))
    srv.daemon_threads = True
    shown = "[%s]" % a.host if ":" in a.host else a.host
    print("p0pc0rn: serving %s at http://%s:%d/  (Ctrl+C to stop)" % (root, shown, a.port))
    if is_loopback(a.host):
        print("  phone: run `tailscale serve --bg %d` once, then open the https://...ts.net address it prints." % a.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
