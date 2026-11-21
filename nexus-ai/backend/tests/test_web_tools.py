from __future__ import annotations

import httpx
import pytest

from app.tools import web


@pytest.fixture(autouse=True)
def fake_network():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "redirect.example":
            return httpx.Response(302, headers={"location": "http://internal.example/admin"})
        return httpx.Response(200, headers={"content-type": "text/html"},
                              content=b"<html><title>Docs</title><script>evil()</script><body><p>Hola mundo</p></body></html>")

    resolver = {"public.example": ["93.184.216.34"], "redirect.example": ["93.184.216.35"], "internal.example": ["10.0.0.5"]}
    web.transport_override = httpx.MockTransport(handler)
    web.resolver_override = lambda host: resolver.get(host, ["127.0.0.1"])
    yield
    web.transport_override = None
    web.resolver_override = None


async def test_fetch_public_page_extracts_text():
    page = await web.fetch_page("https://public.example/docs")
    assert "Hola mundo" in page["text"] and "evil" not in page["text"] and page["text"].startswith("# Docs")


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd",
                                 "http://user:pass@public.example/", "http://localhost/"])
async def test_ssrf_blocked(url):
    with pytest.raises(web.BlockedDestination):
        await web.fetch_page(url)


async def test_redirect_to_private_blocked():
    with pytest.raises(web.BlockedDestination):
        await web.fetch_page("https://redirect.example/")
