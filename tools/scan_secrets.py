#!/usr/bin/env python3
"""scan_secrets.py - stop the release if anything private would ship (Python 3.8+, standard library only).

    python3 tools/scan_secrets.py                  # scan the repository (exit 0 = clean, 1 = problems, 2 = usage)
    python3 tools/scan_secrets.py some/folder a.md # scan just these
    python3 tools/scan_secrets.py --deny NAME      # also fail on NAME (a machine name, a username...; repeatable;
                                                   #   pass private words on the command line, never commit them)
    python3 tools/scan_secrets.py --list-rules

It looks for: access tokens and keys (Hugging Face, GitHub, cloud and chat APIs, Tailscale), private keys, private and
tailnet IP addresses, tailnet host names, drive-letter and home-folder paths, e-mail addresses, files that are secrets by
name, files too big for GitHub, and (as warnings) metadata blocks inside images. Anything else that is private to you
(machine names, your network's names, your own server's address) goes on the command line with --deny.

Text files are read line by line. Images, audio and video are scanned for readable strings (metadata can leak paths and
prompts). Model weights and archives are skipped unless you pass --binaries. Matches are printed masked; tokens are never
printed in full, and --deny words are never printed at all (only their length).

Allowing a known-good match (use sparingly, and only for text you may not change, such as a model's licence):
- on the same line:     ... scan-secrets: allow=<rule>
- in .scan-secrets-allow at the scanned root, one per line:   <rule> <path glob>     (e.g.  email licenses/LICENSE-X.txt)
"""
import argparse
import fnmatch
import os
import re
import sys
from pathlib import Path

ERROR, WARN = "ERROR", "warn"

# Every pattern is written so that this file does not match itself (e.g. "[_]" instead of "_").
RULES = [
    # id, severity, what it is, regex, secret (print masked)
    ("hf-token", ERROR, "Hugging Face access token", r"\bhf_[A-Za-z0-9]{30,}\b", True),
    ("hf-token", ERROR, "Hugging Face org token", r"\bapi_org_[A-Za-z0-9]{20,}\b", True),
    ("github-token", ERROR, "GitHub token", r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b", True),
    ("private-key", ERROR, "private key block", r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----", True),
    ("private-key", ERROR, "PuTTY private key", r"PuTTY-User-Key-File-\d", True),
    ("api-key", ERROR, "Anthropic / OpenAI style API key", r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}", True),
    ("api-key", ERROR, "AWS access key id", r"\bAKIA[0-9A-Z]{16}\b", True),
    ("api-key", ERROR, "Google API key", r"\bAIza[0-9A-Za-z_-]{35}\b", True),
    ("api-key", ERROR, "Slack token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}", True),
    ("api-key", ERROR, "Tailscale auth / API key", r"\btskey-[A-Za-z0-9-]{10,}", True),
    ("api-key", ERROR, "JSON Web Token", r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}", True),
    ("private-ip", ERROR, "private network address", r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", False),
    ("private-ip", ERROR, "private network address", r"\b192\.168\.\d{1,3}\.\d{1,3}\b", False),
    ("private-ip", ERROR, "private address", r"\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b", False),
    ("private-ip", ERROR, "tailnet address (the 100.64/10 range)", r"\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b", False),
    ("tailnet-host", ERROR, "tailnet host name", r"(?i)\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net\b", False),
    ("tailnet-host", ERROR, "tailnet host name (old domain)", r"(?i)\b[a-z0-9-]+\.beta\.tailscale\.net\b", False),
    ("drive-path", ERROR, "Windows drive path", r"(?<![A-Za-z0-9_])[A-Z]:[\\/](?![\\/])", False),
    ("drive-path", ERROR, "Windows user folder", r"(?i)(?<![a-z0-9_])[a-z]:[\\/]+users[\\/]", False),
    ("drive-path", ERROR, "Git Bash drive path", r"(?<![\w.~-])/[a-z]/(?:Users|Program Files|ProgramData)/", False),
    ("home-path", ERROR, "home folder path", r"(?<![\w.-])/(?:Users|home)/[A-Za-z0-9._-]+/", False),
    ("email", ERROR, "e-mail address",
     r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:png|jpe?g|webp|gif|svg|ico|m?js|css|json|html?|md|txt|wasm|ts|map)\b)[A-Za-z]{2,}\b", False),
]
EMAIL_OK = {"git" + "@" + "github.com"}          # an SSH remote, not an address

SECRET_NAMES = ["*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*", "id_ecdsa*", ".env", ".env.*", "*.ppk",
                ".netrc", ".git-credentials", "credentials*.json", "token", "token.txt", "token.json", "tokens.txt",
                "tokens.json", "*[_-]token", "*[_-]token.txt", "*[_-]token.json", "*.token", "cookies*.txt"]
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache"}
TEXT_EXT = {".md", ".txt", ".js", ".mjs", ".cjs", ".ts", ".json", ".html", ".htm", ".css", ".py", ".sh", ".ps1", ".bat",
            ".cmd", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".env", ".webmanifest", ".wgsl", ".svg", ".xml",
            ".csv", ".tsv", ".log", ".gitignore", ".gitattributes", ".map"}
MEDIA_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".mp4", ".m4a", ".mov", ".wav", ".mp3", ".aac", ".pdf"}
WEIGHT_EXT = {".pfw", ".bin", ".safetensors", ".gguf", ".onnx", ".tflite", ".task", ".wasm", ".gz", ".zip", ".npy",
              ".npz", ".pt", ".pth", ".ckpt", ".tar", ".7z", ".br", ".zst"}
GITHUB_HARD = 100 * 1024 * 1024
GITHUB_SOFT = 50 * 1024 * 1024
STRINGS = re.compile(rb"[\x20-\x7e]{6,}")
ALLOW_INLINE = re.compile(r"scan-secrets:\s*allow=([a-z-]+)")

COMPILED = [(rid, sev, what, re.compile(rx), sec) for rid, sev, what, rx, sec in RULES]


def mask(rule, text, secret):
    if rule == "deny":
        return "<private:%d chars>" % len(text)
    if secret:
        return "%s... (%d chars)" % (text[:4], len(text))
    if rule == "email" and "@" in text:
        local, dom = text.split("@", 1)
        return "%s...@%s" % (local[:2], dom)
    return text if len(text) <= 48 else text[:45] + "..."


def load_allow(root):
    out = []
    f = root / ".scan-secrets-allow"
    if f.is_file():
        for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                parts = line.split(None, 1)
                if len(parts) == 2:
                    out.append((parts[0], parts[1].replace("\\", "/")))
    return out


def allowed(rel, rule, allow):
    return any(r in (rule, "*") and fnmatch.fnmatch(rel, g) for r, g in allow)


def scan_line(text, deny):
    """yield (rule, severity, what, match, secret) for one line or string"""
    for rid, sev, what, rx, sec in COMPILED:
        for m in rx.finditer(text):
            s = m.group(0)
            if rid == "email" and s.lower() in EMAIL_OK:
                continue
            yield rid, sev, what, s, sec
    for word, rx in deny:
        for m in rx.finditer(text):
            yield "deny", ERROR, "a private word passed with --deny", m.group(0), True


def media_metadata(path, head):
    """warn on metadata blocks that can carry prompts, workflows, paths or camera data"""
    ext = path.suffix.lower()
    if ext == ".png" and head.startswith(b"\x89PNG"):
        found = [c.decode() for c in (b"tEXt", b"iTXt", b"zTXt", b"eXIf") if c in head]
        return "PNG chunks " + ", ".join(found) if found else None
    if ext in (".jpg", ".jpeg") and head.startswith(b"\xff\xd8"):
        found = [n for n, c in (("EXIF", b"Exif\x00"), ("XMP", b"ns.adobe.com/xap"), ("IPTC", b"Photoshop 3.0")) if c in head]
        return "JPEG " + ", ".join(found) if found else None
    if ext == ".webp" and head[:4] == b"RIFF":
        found = [c.decode() for c in (b"EXIF", b"XMP ") if c in head]
        return "WebP chunks " + ", ".join(found) if found else None
    return None


def walk(paths):
    for p in paths:
        if p.is_file():
            yield p
            continue
        for dirpath, dirnames, filenames in os.walk(p):
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
            for name in sorted(filenames):
                yield Path(dirpath) / name


def default_root():
    here = Path(__file__).resolve().parent
    if here.name == "tools" and (here.parent / "index.html").is_file():
        return here.parent
    return Path.cwd()


def main(argv=None):
    ap = argparse.ArgumentParser(description="Fail if anything private would ship.")
    ap.add_argument("paths", nargs="*", type=Path, help="files or folders (default: the repository root)")
    ap.add_argument("--deny", action="append", default=[], metavar="WORD", help="also fail on this word (case-insensitive)")
    ap.add_argument("--binaries", action="store_true", help="also scan model weights and archives for strings")
    ap.add_argument("--strict", action="store_true", help="warnings fail too")
    ap.add_argument("--list-rules", action="store_true", help="print the rules and exit")
    a = ap.parse_args(argv)

    if a.list_rules:
        for rid, sev, what, _, _ in RULES:
            print("%-15s %-5s %s" % (rid, sev, what))
        print("%-15s %-5s %s" % ("secret-file", ERROR, "a file that is a secret by its name: " + " ".join(SECRET_NAMES)))
        print("%-15s %-5s %s" % ("too-big", ERROR, "a file over GitHub's 100 MB limit (50 MB = warning)"))
        print("%-15s %-5s %s" % ("media-metadata", WARN, "text / EXIF / XMP blocks inside an image"))
        return 0

    paths = [p.resolve() for p in (a.paths or [default_root()])]
    for p in paths:
        if not p.exists():
            print("no such file or folder: %s" % p, file=sys.stderr)
            return 2
    base = paths[0] if paths[0].is_dir() else paths[0].parent
    allow = load_allow(base)
    deny = [(w, re.compile(re.escape(w), re.I)) for w in a.deny if w.strip()]

    hits, files, skipped = [], 0, 0

    def add(rel, where, rule, sev, what, text, secret, line_text=""):
        if allowed(rel, rule, allow):
            return
        m = ALLOW_INLINE.search(line_text)
        if m and m.group(1) == rule:
            return
        hits.append((sev, rule, "%s%s" % (rel, where), what, mask(rule, text, secret)))

    for f in walk(paths):
        try:
            rel = f.relative_to(base).as_posix()
        except ValueError:
            rel = f.as_posix()
        files += 1
        name, ext = f.name, f.suffix.lower()
        try:
            size = f.stat().st_size
        except OSError:
            continue
        if any(fnmatch.fnmatch(name.lower(), g) for g in SECRET_NAMES):
            add(rel, "", "secret-file", ERROR, "a file that is a secret by its name", name, False)
        if size >= GITHUB_HARD:
            add(rel, "", "too-big", ERROR, "over GitHub's 100 MB limit (packs go to Hugging Face)", "%d MB" % (size >> 20), False)
        elif size >= GITHUB_SOFT:
            add(rel, "", "too-big", WARN, "over 50 MB (GitHub warns)", "%d MB" % (size >> 20), False)
        if size > 200 * 1024 * 1024 or (ext in WEIGHT_EXT and not a.binaries):
            skipped += 1
            continue
        try:
            data = f.read_bytes()
        except OSError as e:
            print("could not read %s: %s" % (rel, e), file=sys.stderr)
            continue
        is_text = ext in TEXT_EXT or (ext not in MEDIA_EXT and ext not in WEIGHT_EXT and b"\x00" not in data[:8192])
        if is_text:
            for n, line in enumerate(data.decode("utf-8", errors="replace").splitlines(), 1):
                for rule, sev, what, s, sec in scan_line(line, deny):
                    add(rel, ":%d" % n, rule, sev, what, s, sec, line)
        else:
            meta = media_metadata(f, data[: 1 << 20]) if ext in MEDIA_EXT else None
            if meta:
                add(rel, "", "media-metadata", WARN, "metadata block (strip it before shipping)", meta, False)
            for m in STRINGS.finditer(data):
                chunk = m.group(0).decode("ascii")
                for rule, sev, what, s, sec in scan_line(chunk, deny):
                    add(rel, "@%d" % m.start(), rule, sev, what, s, sec)

    errors = [h for h in hits if h[0] == ERROR]
    warns = [h for h in hits if h[0] == WARN]
    for sev, rule, where, what, shown in errors + warns:
        print("%-5s %-15s %s  %s: %s" % (sev, rule, where, what, shown))
    print("scan_secrets: %d file(s) checked, %d weight/archive file(s) skipped, %d error(s), %d warning(s)"
          % (files, skipped, len(errors), len(warns)))
    if errors or (a.strict and warns):
        print("NOT CLEAN: fix or remove the lines above before anything ships.")
        return 1
    print("clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
