package ai.nexus.app

import ai.nexus.app.core.avatar.isActiveStatus
import ai.nexus.app.core.realtime.backoffSeconds
import ai.nexus.app.core.realtime.parseEvent
import ai.nexus.app.core.ui.MdBlock
import ai.nexus.app.core.ui.parseMarkdown
import ai.nexus.app.data.model.TaskDto
import ai.nexus.app.features.missions.topoLevels
import ai.nexus.app.push.NotificationHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class LogicTest {
    @Test fun `realtime events are parsed and invalid payloads ignored`() {
        val e = parseEvent("""{"id":"1","type":"agent.status","ts":"2026-01-01T00:00:00Z","data":{"agent_id":"a","status":"working"}}""")!!
        assertEquals("agent.status", e.type)
        assertEquals("working", e.str("status"))
        assertNull(parseEvent("no json"))
        assertNull(parseEvent("""{"data":{}}"""))
    }

    @Test fun `reconnection backoff grows and is capped`() {
        val r = Random(1)
        val waits = (1..10).map { backoffSeconds(it, r) }
        assertTrue(waits.first() in 1..3)
        assertTrue(waits.all { it in 1..38 })
        assertTrue(waits.last() >= 22)
    }

    private fun task(id: String, deps: List<String> = emptyList()) =
        TaskDto(id = id, missionId = "m", key = id, title = id, description = "", taskType = "general", status = "pending", createdAt = "x", dependsOn = deps)

    @Test fun `mission flow graph is laid out by dependency level`() {
        val levels = topoLevels(listOf(task("t1"), task("t2"), task("t3", listOf("t1", "t2")), task("t4", listOf("t3"))))
        assertEquals(listOf(listOf("t1", "t2"), listOf("t3"), listOf("t4")), levels.map { l -> l.map { it.id } })
        // Un ciclo (dato corrupto) no debe colgar la app
        assertEquals(2, topoLevels(listOf(task("a", listOf("b")), task("b", listOf("a")))).flatten().size)
    }

    @Test fun `markdown parser handles agent reports`() {
        val blocks = parseMarkdown("# Informe\n\nTexto **clave** largo\ncontinúa.\n\n- uno\n2. dos\n\n```py\nprint(1)\n```\n> cita")
        assertEquals(MdBlock.Heading(1, "Informe"), blocks[0])
        assertEquals(MdBlock.Paragraph("Texto **clave** largo continúa."), blocks[1])
        assertEquals(MdBlock.Bullet("uno"), blocks[2])
        assertEquals(MdBlock.Bullet("dos", "2."), blocks[3])
        assertEquals(MdBlock.Code("print(1)"), blocks[4])
        assertEquals(MdBlock.Quote("cita"), blocks[5])
    }

    @Test fun `notifications open the related screen`() {
        assertEquals("approvals", NotificationHelper.routeFor("approval_requested", mapOf("approval_id" to "x", "mission_id" to "m")))
        assertEquals("mission/m1", NotificationHelper.routeFor("mission_completed", mapOf("mission_id" to "m1")))
        assertEquals("meeting/g", NotificationHelper.routeFor("meeting_finished", mapOf("meeting_id" to "g")))
        assertEquals("settings/budgets", NotificationHelper.routeFor("budget_reached", emptyMap()))
    }

    @Test fun `avatar animation only for real active states`() {
        assertTrue(isActiveStatus("working") && isActiveStatus("thinking") && isActiveStatus("collaborating"))
        assertTrue(!isActiveStatus("idle") && !isActiveStatus("completed") && !isActiveStatus("error"))
    }
}
