# Third-party notices

## XHS-Downloader

Copyright JoeanAmier and contributors. GNU GPL version 3.

Source: https://github.com/JoeanAmier/XHS-Downloader

Version: 2.8. Commit: `47840a1bee8438324ff10753c4291148c46071c8`.

Original license: `collector/LICENSE.upstream`. The pinned unmodified source is retained in `collector/vendor/`. Integration wrapper: `collector/server.py`. Desktop-only `pywebview` is not installed by this API-only integration; the remaining dependency versions are locked in `collector/requirements.lock`.

## xiaohongshu-mcp publisher fork

Copyright xpzouying and contributors. Apache License 2.0.

Source: https://github.com/xpzouying/xiaohongshu-mcp/tree/v2.5.5

Pinned tag: `v2.5.5`. Modified vendored source and original license: `publisher/upstream/`, `publisher/upstream/LICENSE`. Provenance, archive digest and modification notes: `publisher/README.md`; source differences: `publisher/workbench.patch`.

This integration uses locally installed Chrome/Edge and disables the upstream custom browser download, fingerprint options and stealth script. Its routes are restricted to authenticated local login and publishing operations. Login sessions use Windows DPAPI. Upstream names and documentation are preserved for attribution, not to represent an endorsement. Locked transitive dependencies are recorded in `publisher/upstream/go.mod` and `go.sum`, including go-rod (MIT) and headless_browser (MIT).

## Other dependencies

- Gin: MIT, https://github.com/gin-gonic/gin
- modernc.org/sqlite: BSD-3-Clause, https://gitlab.com/cznic/sqlite
- Gorilla WebSocket: BSD-2-Clause, https://github.com/gorilla/websocket
- React: MIT, https://github.com/facebook/react
- Ant Design: MIT, https://github.com/ant-design/ant-design
- Vite: MIT, https://github.com/vitejs/vite
- TypeScript: Apache-2.0, https://github.com/microsoft/TypeScript
- FFmpeg: license depends on the selected build; bundled Gyan essentials includes GPL components. Original licenses are retained in its extracted runtime directory. https://ffmpeg.org/legal.html
- Python: PSF License, retained in the embedded runtime. https://www.python.org/psf/license/
- uv: MIT or Apache-2.0, https://github.com/astral-sh/uv

Dependency packages retain their original license files in installed directories. Application data, keys, Cookie and generated user content are not included in the source archive.


## 抖音参考与依赖

- douyin-downloader，提交 9874f413b2c1f8ad6e731b26e3e05f402fc964f8，MIT，Copyright (c) 2026 jiji262。仅保留登录源文件的参考文本副本，不执行。原许可证、SHA-256 与来源见 douyin/README.md 和 douyin/reference/LICENSE。
- Playwright 1.56.1，Microsoft，Apache-2.0。依赖版本与完整性记录见 douyin/package-lock.json。
