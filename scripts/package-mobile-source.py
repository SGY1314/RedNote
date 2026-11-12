"""Create a portable source archive without accounts, local config or secrets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
output = Path(args.output).resolve()
files = []
with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if not file.is_file() or file.is_symlink():
            continue
        if relative.parts[0] in {'data', 'bin', 'logs', '.tools', '.git'}:
            continue
        if any(part in {'node_modules', '__pycache__', '.git', 'test-results', 'dist', 'coverage'} for part in relative.parts):
            continue
        if file.suffix in {'.log', '.tsbuildinfo', '.key', '.pem', '.sqlite', '.db', '.zip'}:
            continue
        name = relative.as_posix()
        if name == 'mobile-source-manifest.json':
            continue
        if (file.name.startswith('.env') or file.name.endswith('.local.json')
                or file.name == 'project.private.config.json' or name == 'config/local.json'):
            continue
        # The miniapp imports this module unconditionally: include a safe blank
        # template rather than an absent module or a developer's private values.
        content = b'module.exports = {};\n' if name == 'miniapp/RedNote/config/runtime.local.js' else file.read_bytes()
        archive.writestr('xhs-workbench/' + name, content)
        files.append({'path': name, 'sha256': hashlib.sha256(content).hexdigest()})
    archive.writestr('xhs-workbench/mobile-source-manifest.json', json.dumps({
        'base': 'RedNote-Workbench-双平台源码-20261025-v19',
        'feature': 'mobile-image-publishing',
        'accounts_included': False,
        'local_connection_config_included': False,
        'control_credentials_included': False,
        'files': files,
    }, ensure_ascii=False, indent=2))
print(json.dumps({'package': str(output), 'files': len(files), 'bytes': output.stat().st_size,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}, ensure_ascii=False))
