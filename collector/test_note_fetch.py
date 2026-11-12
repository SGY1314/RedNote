import unittest
from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

from curl_cffi.requests.exceptions import ConnectionError
from note_fetch import CollectionError, fetch_note, resolve_public, status_error, validate_url


class NoteFetchTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_access_without_cookie_and_verified_tls(self):
        response = SimpleNamespace(status_code=200, content=b"public note", text="public note")
        client = AsyncMock()
        client.get.return_value = response
        client.__aenter__.return_value = client
        with patch("note_fetch.resolve_public", AsyncMock(return_value="81.69.116.102")), patch("note_fetch.AsyncSession", return_value=client) as factory:
            self.assertEqual(await fetch_note("https://www.xiaohongshu.com/explore/abc?xsec_token=test"), "public note")
            self.assertNotIn("Cookie", client.get.call_args.kwargs["headers"])
            self.assertTrue(factory.call_args.kwargs["verify"])
            self.assertFalse(client.get.call_args.kwargs["allow_redirects"])

    async def test_connection_failure_is_not_reported_as_cookie_failure(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get.side_effect = ConnectionError("untrusted details Cookie=SECRET", code=7)
        with patch("note_fetch.resolve_public", AsyncMock(return_value="81.69.116.102")), patch("note_fetch.AsyncSession", return_value=client):
            with self.assertRaises(CollectionError) as caught:
                await fetch_note("https://www.xiaohongshu.com/explore/abc")
            self.assertEqual(str(caught.exception), "network_unreachable")

    async def test_external_redirect_does_not_receive_cookie(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get.return_value = SimpleNamespace(status_code=302, headers={"location": "https://example.com/"})
        with patch("note_fetch.resolve_public", AsyncMock(return_value="81.69.116.102")), patch("note_fetch.AsyncSession", return_value=client):
            with self.assertRaises(CollectionError) as caught:
                await fetch_note("https://www.xiaohongshu.com/explore/abc", cookie="secret")
            self.assertEqual(caught.exception.code, "unsafe_redirect")
            self.assertEqual(client.get.await_count, 1)

    async def test_dns_private_address_rejected(self):
        with patch("asyncio.get_running_loop") as loop:
            loop.return_value.getaddrinfo = AsyncMock(return_value=[(2, 1, 6, "", ("127.0.0.1", 443))])
            with self.assertRaises(CollectionError):
                await resolve_public("www.xiaohongshu.com")

    def test_status_classification_and_url_validation(self):
        for status, code in [(401,"login_required"),(403,"access_restricted"),(404,"note_unavailable"),(429,"rate_limited"),(503,"upstream_error")]:
            self.assertEqual(status_error(status, "https://www.xiaohongshu.com/explore/abc"), code)
        self.assertEqual(status_error(200,"https://www.xiaohongshu.com/login"), "login_required")
        for url in ["https://localhost/", "https://www.xiaohongshu.com:80/", "https://www.xiaohongshu.com@evil.test/", "file:///etc/passwd"]:
            with self.assertRaises(CollectionError):
                validate_url(url)


if __name__ == "__main__":
    unittest.main()
