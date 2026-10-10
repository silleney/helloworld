"""Developer packaging only: run after npm run build -- --target=safari15.4."""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

repo = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='ledger-v11-package-') as tmp:
    root = Path(tmp) / '小账-V1.1-局域网验收包'
    root.mkdir()
    for source in (repo / 'acceptance/tools').iterdir():
        if source.is_file() and source.name != 'verify-iphone-tools.py':
            shutil.copy2(source, root / source.name)
    shutil.copytree(repo / 'dist', root / 'site')
    shutil.copy2(repo / 'docs/V1.1-验收指南.md', root / 'V1.1-验收指南.md')
    manifest = {
        'version': '1.1',
        'base_commit': '3a924bd5a308fa8326a5e97c70b13adb458dab7b',
        'source_branch': 'v1.1-mobile-redesign',
        'build_command': 'npm run build -- --target=safari15.4',
        'files_sha256': {str(p.relative_to(root / 'site')): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in sorted((root / 'site').rglob('*')) if p.is_file()},
    }
    (root / 'BUILD.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    with zipfile.ZipFile(repo / 'acceptance/小账-V1.1-局域网验收包.zip', 'w', zipfile.ZIP_DEFLATED) as bundle:
        for source in sorted(root.rglob('*')):
            if source.is_file():
                bundle.write(source, str(source.relative_to(Path(tmp))))
print('Created acceptance ZIP; no certificates or keys included.')
