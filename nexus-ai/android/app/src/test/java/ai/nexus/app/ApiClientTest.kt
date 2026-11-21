package ai.nexus.app

import ai.nexus.app.core.network.ApiClient
import ai.nexus.app.core.network.ApiException
import ai.nexus.app.core.network.TokenProvider
import ai.nexus.app.data.api.NexusApi
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class ApiClientTest {
    private lateinit var server: MockWebServer
    private val tokens = FakeTokens()

    inner class FakeTokens : TokenProvider {
        var access: String? = "old-access"
        var refresh: String? = "refresh-1"
        var expired = false
        override suspend fun baseUrl() = server.url("/").toString()
        override suspend fun accessToken() = access
        override suspend fun refreshToken() = refresh
        override suspend fun onTokens(access: String, refresh: String) { this.access = access; this.refresh = refresh }
        override suspend fun onSessionExpired() { expired = true; access = null; refresh = null }
    }

    private fun api() = NexusApi(ApiClient(OkHttpClient(), tokens))

    @Before fun setUp() { server = MockWebServer(); server.start() }
    @After fun tearDown() = server.shutdown()

    @Test fun `401 triggers a single refresh and retries with the new token`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"detail":"Token inválido o expirado"}"""))
        server.enqueue(MockResponse().setBody("""{"access_token":"new-access","refresh_token":"refresh-2","access_expires_at":"x","refresh_expires_at":"y"}"""))
        server.enqueue(MockResponse().setBody("""[{"id":"a1","slug":"nexus","name":"NEXUS","role":"CEO","status":"working","profile":{"appearance":{"hair":"short"}}}]"""))
        val agents = api().agents()
        assertEquals("NEXUS", agents.single().name)
        assertEquals("working", agents.single().status)
        val first = server.takeRequest(); val refresh = server.takeRequest(); val retry = server.takeRequest()
        assertEquals("Bearer old-access", first.getHeader("authorization"))
        assertEquals("/api/v1/auth/refresh", refresh.path)
        assertTrue(refresh.body.readUtf8().contains("refresh-1"))
        assertEquals("Bearer new-access", retry.getHeader("authorization"))
        assertEquals("refresh-2", tokens.refresh)
    }

    @Test fun `failed refresh expires the session`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"invalid_credentials","message":"La sesión fue revocada"}"""))
        try { api().agents(); fail("debía fallar") } catch (e: ApiException) {
            assertEquals(401, e.status); assertEquals("session_expired", e.code)
        }
        assertTrue(tokens.expired)
    }

    @Test fun `server errors are translated to readable messages`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(402).setBody("""{"error":"budget_exceeded","message":"Límite diario alcanzado"}"""))
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"detail":[{"loc":["body","password"],"msg":"La contraseña debe combinar mayúsculas"}]}"""))
        try { api().dashboard(); fail() } catch (e: ApiException) { assertEquals("budget_exceeded", e.code); assertEquals("Límite diario alcanzado", e.message) }
        try { api().register("a@b.c", "x", "y"); fail() } catch (e: ApiException) { assertEquals("La contraseña debe combinar mayúsculas", e.message) }
    }

    @Test fun `network failures are reported as network errors`() = runBlocking {
        server.shutdown()
        try { api().agents(); fail() } catch (e: ApiException) { assertTrue(e.isNetwork) }
        assertFalse(tokens.expired)
    }

    @Test fun `query parameters and auth-less login`() = runBlocking {
        server.enqueue(MockResponse().setBody("""{"user":{"id":"u","email":"a@b.c","display_name":"Ana"},"tokens":{"access_token":"a","refresh_token":"r","access_expires_at":"x","refresh_expires_at":"y"}}"""))
        server.enqueue(MockResponse().setBody("[]"))
        val auth = api().login("a@b.c", "Clave12345")
        assertEquals("Ana", auth.user.displayName)
        assertEquals(null, server.takeRequest().getHeader("authorization"))
        api().missions(status = "running,planning", projectId = null)
        val path = server.takeRequest().path!!
        assertTrue(path, path.startsWith("/api/v1/missions?status=running%2Cplanning") && !path.contains("project_id"))
    }
}
