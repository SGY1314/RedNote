"""Local authenticated wrapper around the pinned upstream /xhs/detail route.

No upstream request/response body is logged. params is discarded before response.
"""
import asyncio
import contextlib
import hmac
import importlib
import json
import os
from pathlib import Path
import sys
import types

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))  # Windows embedded Python uses an isolated sys.path.
COMMIT = "47840a1bee8438324ff10753c4291148c46071c8"
VENDOR = ROOT / "collector" / "vendor" / f"XHS-Downloader-{COMMIT}"
# Import the actual application package without upstream's desktop/TUI entrypoint.
package = types.ModuleType("source")
package.__path__ = [str(VENDOR / "source")]
sys.modules["source"] = package
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from source.application import XHS
from source.module import ExtractParams
from note_fetch import CollectionError, fetch_note

lock = asyncio.Lock()
engine = None
upstream_handle = None

@contextlib.asynccontextmanager
async def lifespan(app):
    global engine, upstream_handle
    data = ROOT / "data" / "collector"
    data.mkdir(parents=True, exist_ok=True)
    async with XHS(work_path=str(data), cookie="", record_data=False,
                   download_record=False, script_server=False, note_format="",
                   max_retry=1, timeout=20) as instance:
        engine = instance
        # The upstream request helper swallows transport errors and returns an
        # empty page. Preserve safe error categories, with anonymous access by
        # default and verified TLS, without changing the pinned parser.
        engine.html.request_url = fetch_note
        # Suppress upstream log text; all failures are mapped to fixed messages.
        engine.logging = lambda *args, **kwargs: None
        upstream = FastAPI()
        engine.setup_routes(upstream)
        upstream_handle = next(r.endpoint for r in upstream.routes if r.path == "/xhs/detail")
        yield

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def authenticate(request: Request, call_next):
    token_file = ROOT / "data" / "collector.token"
    expected = token_file.read_text().strip() if token_file.exists() else ""
    if (request.headers.get("origin") or not expected or
            not hmac.compare_digest(request.headers.get("x-collector-token", ""), expected)):
        return JSONResponse({"error": "Forbidden"}, status_code=403)
    if int(request.headers.get("content-length", "0") or "0") > 65536:
        return JSONResponse({"error": "Request too large"}, status_code=413)
    return await call_next(request)

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse({"error": "Invalid request"}, status_code=400)

@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.8", "commit": COMMIT}

@app.post("/xhs/detail")
async def detail(params: ExtractParams):
    from urllib.parse import urlparse
    u = urlparse(params.url)
    if u.scheme not in ("http", "https") or u.hostname not in ("www.xiaohongshu.com", "xiaohongshu.com") or u.username or u.port:
        return JSONResponse({"error": "Only resolved XHS note URLs are allowed"}, status_code=400)
    params.download = False
    params.check_record = False
    params.proxy = None
    params.cookie = None
    async with lock:
        try:
            # Third-party libraries may print request diagnostics: suppress stdout
            # and stderr for the serialized extraction, never the wrapper response.
            with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
                result = await upstream_handle(params)
            fields = ("作品ID", "作品标题", "作品描述", "作品标签", "作品类型", "发布时间",
                      "作者昵称", "作者ID", "点赞数量", "收藏数量", "评论数量", "分享数量",
                      "下载地址", "动图地址", "封面地址")
            data = result.data or {}
            if not data.get("作品ID"):
                from urllib.parse import parse_qs
                code = "page_unrecognized" if parse_qs(u.query).get("xsec_token") else "missing_share_token"
                return {"data": {}, "error_code": code}
            return {"data": {k: data[k] for k in fields if k in data}}
        except CollectionError as exc:
            return {"data": {}, "error_code": exc.code}
        except Exception:
            return {"data": {}, "error_code": "parse_failed"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5557, access_log=False, log_level="warning")
