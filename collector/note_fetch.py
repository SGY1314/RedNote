"""Public note requests with explicit, non-secret failure categories.

No browser cookies are read. An optional user-configured cookie is sent only to
the allowlisted XHS website. Upstream parsing remains pinned and unchanged.
"""
import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

from curl_cffi import CurlOpt
from curl_cffi.requests import AsyncSession
from curl_cffi.requests.exceptions import RequestException


class CollectionError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def validate_url(url):
    try:
        parsed = urlparse(url)
        if (parsed.scheme not in ("http", "https") or parsed.username or
                parsed.password or parsed.port or parsed.hostname not in
                {"www.xiaohongshu.com", "xiaohongshu.com"}):
            raise ValueError()
    except ValueError:
        raise CollectionError("unsafe_redirect") from None
    return parsed


async def resolve_public(host):
    try:
        addresses = await asyncio.get_running_loop().getaddrinfo(
            host, 443, type=socket.SOCK_STREAM)
    except OSError:
        raise CollectionError("network_unreachable") from None
    if not addresses:
        raise CollectionError("network_unreachable")
    ips = {entry[4][0] for entry in addresses}
    if any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise CollectionError("unsafe_redirect")
    # Prefer IPv4 on Windows hosts without a working IPv6 route. Pin the checked
    # address so curl cannot resolve a different address after validation.
    return sorted(ips, key=lambda ip: (":" in ip, ip))[0]


def status_error(status, url):
    if status == 429:
        return "rate_limited"
    if status == 401 or urlparse(url).path.startswith(("/login", "/signin")):
        return "login_required"
    if status == 403:
        return "access_restricted"
    if status in (404, 410):
        return "note_unavailable"
    if status >= 400:
        return "upstream_error"
    return None


async def fetch_note(url, content=True, cookie=None, proxy=None, **kwargs):
    # Caller-controlled proxies are intentionally unsupported for note requests.
    for _ in range(6):
        parsed = validate_url(url)
        if parsed.scheme == "http":
            url = parsed._replace(scheme="https").geturl()
            parsed = urlparse(url)
        ip = await resolve_public(parsed.hostname)
        if ":" in ip:
            ip = f"[{ip}]"
        headers = {
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.xiaohongshu.com/",
        }
        if cookie:
            headers["Cookie"] = cookie
        try:
            async with AsyncSession(
                    impersonate="chrome146", verify=True, trust_env=False,
                    curl_options={CurlOpt.RESOLVE: [f"{parsed.hostname}:443:{ip}"]}) as client:
                response = await client.get(url, headers=headers, timeout=20,
                                            allow_redirects=False)
        except RequestException as exc:
            code = "tls_error" if int(getattr(exc, "code", 0)) in (35, 51, 58, 60, 77, 83) else "network_unreachable"
            raise CollectionError(code) from None
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get("location")
            if not location:
                raise CollectionError("upstream_error")
            url = urljoin(url, location)
            validate_url(url)
            code = status_error(200, url)
            if code:
                raise CollectionError(code)
            continue
        code = status_error(response.status_code, url)
        if code:
            raise CollectionError(code)
        if len(response.content) > 5 * 1024 * 1024:
            raise CollectionError("page_unrecognized")
        return response.text if content else url
    raise CollectionError("too_many_redirects")
