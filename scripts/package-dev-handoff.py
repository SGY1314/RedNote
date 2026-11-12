"""Package current developer source without local accounts, data or dependencies."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile
from datetime import datetime

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True)
args = parser.parse_args()
output = Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
if output.exists():
    raise SystemExit("Refusing to overwrite an existing archive")
roots = {"cmd", "internal", "collector", "douyin", "publisher", "scripts", "docs", "web", "miniapp"}
skip = {"node_modules", ".git", "__pycache__", "dist", "test-results", "coverage", ".venv", "venv", ".pytest_cache", ".mypy_cache", "Volume", ".runtime", "data", "logs", "profiles", "browser-profile", ".tools", "bin"}
private_suffixes = {".log", ".tsbuildinfo", ".key", ".pem", ".sqlite", ".sqlite3", ".db", ".db-wal", ".db-shm", ".zip", ".exe", ".dll", ".pyc", ".pyo", ".dpapi", ".token", ".bak"}
files = {}
for top in sorted(roots):
    for directory, dirs, names in os.walk(root / top):
        dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith("src-backup-") and not (Path(directory) / d).is_symlink())
        for name in sorted(names):
            p = Path(directory) / name
            if p.is_symlink() or p.suffix.lower() in private_suffixes or name.startswith(".env") or name.endswith(".local.json") or name == "project.private.config.json":
                continue
            rel = p.relative_to(root).as_posix()
            if name in {"cookies.json", "session.json", "storage-state.json", "storageState.json"}:
                continue
            files[rel] = b"module.exports = {};\n" if rel == "miniapp/RedNote/config/runtime.local.js" else p.read_bytes()
for p in root.iterdir():
    if p.is_file() and (p.suffix.lower() in {".md", ".cmd"} or p.name in {"go.mod", "go.sum", ".gitignore"} or p.name.startswith("config.") and p.name.endswith(".example.json")):
        files[p.name] = p.read_bytes()
for name in ("config/example.json", "config/model-presets.json"):
    files[name] = (root / name).read_bytes()
# Current reports are maintained in docs; never import historical live-data reports.
files.setdefault("miniapp/RedNote/config/runtime.local.js", b"module.exports = {};\n")
# Check against credential values from local config without logging those values.
secrets = set()
def credentials(value):
    if isinstance(value, dict):
        for key, item in value.items():
            compact = key.lower().replace("_", "").replace("-", "")
            if any(k in compact for k in ("secret", "password", "apikey", "token", "cookie")) and isinstance(item, str) and len(item) >= 10:
                secrets.add(item.encode())
            credentials(item)
    elif isinstance(value, list):
        for item in value: credentials(item)
for name in ("config/local.json", "config.cloud.local.json", "config.douyin.local.json", "config.miniapp.local.json"):
    p = root / name
    if p.exists(): credentials(json.loads(p.read_text(encoding="utf-8-sig")))
for rel, content in files.items():
    if any(secret in content for secret in secrets):
        raise SystemExit("Local credential match in included file: " + rel)
    if (b"-----BEGIN " + b"PRIVATE KEY-----") in content or (b"-----BEGIN RSA " + b"PRIVATE KEY-----") in content:
        raise SystemExit("Private key marker in included file: " + rel)
manifest = {"created_at": datetime.now().isoformat(timespec="seconds"), "purpose": "developer-handoff", "accounts_included": False, "local_config_included": False, "dependencies_included": False, "files": [{"path": rel, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} for rel, content in sorted(files.items())]}
files["source-manifest.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
with zipfile.ZipFile(output, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for rel, content in sorted(files.items()):
        archive.writestr("RedNote-Source/" + rel, content)
# Verify CRC, hashes, required inputs and exclusion policy from the archive itself.
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for entry in manifest["files"]:
        assert hashlib.sha256(archive.read("RedNote-Source/" + entry["path"])).hexdigest() == entry["sha256"]
    for rel in ("internal/app/publication_replacement_test.go", "web/src/publicationVisibility.ts", "web/package-lock.json", "go.sum", "config/example.json", "docs/MAINTENANCE.md"):
        assert "RedNote-Source/" + rel in archive.namelist()
    for name in archive.namelist():
        rel = Path(name).parts[1:]
        assert not any(p in skip for p in rel)
        assert not name.endswith(".local.json")
        assert not name.startswith("RedNote-Source/config/local")
    assert archive.read("RedNote-Source/miniapp/RedNote/config/runtime.local.js") == b"module.exports = {};\n"
digest = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix(".sha256.txt").write_text(digest + "  " + output.name + "\n", encoding="utf-8")
print(json.dumps({"archive": str(output), "files": len(files), "bytes": output.stat().st_size, "sha256": digest, "integrity": "verified"}, ensure_ascii=False))
