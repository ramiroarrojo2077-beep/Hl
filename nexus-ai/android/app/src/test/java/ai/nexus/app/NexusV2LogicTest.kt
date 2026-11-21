package ai.nexus.app

import ai.nexus.app.actions.ActionExecutor
import ai.nexus.app.core.avatar.CoreSignals
import ai.nexus.app.core.avatar.CoreState
import ai.nexus.app.core.avatar.coreStateOf
import ai.nexus.app.core.realtime.ConnectionState
import ai.nexus.app.core.realtime.EventDeduplicator
import ai.nexus.app.data.model.VoicePrefs
import ai.nexus.app.voice.BargeIn
import ai.nexus.app.voice.BargeInDetector
import ai.nexus.app.voice.Recognizer
import ai.nexus.app.voice.RecognizerListener
import ai.nexus.app.voice.Speaker
import ai.nexus.app.voice.SpeakerListener
import ai.nexus.app.voice.SpeechText
import ai.nexus.app.voice.VoiceEngine
import ai.nexus.app.voice.VoiceError
import ai.nexus.app.whatsapp.ContactResolver
import ai.nexus.app.whatsapp.ContactSource
import ai.nexus.app.whatsapp.PhoneNormalizer
import ai.nexus.app.whatsapp.Resolution
import ai.nexus.app.whatsapp.SavedContact
import ai.nexus.app.whatsapp.WaState
import ai.nexus.app.whatsapp.WhatsAppFlow
import android.content.Intent
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File

/** Lógica pura de NEXUS 2.0 (sin red ni UI). */
class NexusV2LogicTest {
    @Test fun `phone normalizer matches the vectors shared with the backend`() {
        val file = listOf(File("../../shared/phone_vectors_ar.json"), File("../shared/phone_vectors_ar.json")).first { it.exists() }
        val cases = Json.parseToJsonElement(file.readText()).jsonObject["cases"]!!.jsonArray
        assertTrue(cases.size >= 20)
        for (el in cases) {
            val c = el.jsonObject
            fun opt(k: String) = (c[k] as? JsonPrimitive)?.contentOrNull
            val input = opt("input")!!
            val r = PhoneNormalizer.normalize(input, opt("default_area_code"))
            assertEquals("estado de $input", opt("status"), r.status)
            assertEquals("e164 de $input", opt("e164"), r.e164)
            assertEquals("máscara de $input", opt("masked"), r.masked)
            assertEquals("display de $input", opt("display"), r.display)
        }
        assertEquals("https://wa.me/5491123456789?text=Llego%20en%205", PhoneNormalizer.waLink("5491123456789", "Llego en 5"))
    }

    private val book = listOf(
        SavedContact("1", "Papá", "1123456789", aliases = listOf("papi")),
        SavedContact("2", "Mamá", "1123456780"),
        SavedContact("3", "Juan Pérez", "3511234567"),
        SavedContact("4", "Juan Gómez", "3511234568"),
        SavedContact("5", "Carolina", "2214567890", aliases = listOf("Caro"), favorite = true),
    )

    @Test fun `contact resolver understands aliases synonyms and ambiguity`() {
        assertEquals("1", (ContactResolver.resolve("mi viejo", book) as Resolution.Resolved).contact.id)
        assertEquals("1", (ContactResolver.resolve("papá", book) as Resolution.Resolved).contact.id)
        assertEquals("5", (ContactResolver.resolve("Caro", book) as Resolution.Resolved).contact.id)
        val amb = ContactResolver.resolve("Juan", book) as Resolution.Ambiguous
        assertEquals(setOf("3", "4"), amb.candidates.map { it.id }.toSet())
        assertEquals(Resolution.NotFound, ContactResolver.resolve("el plomero", book))
    }

    @Test fun `barge-in ignores echo and reacts to commands and new phrases`() {
        val speaking = "Canberra es la capital de Australia y queda en el territorio de la capital"
        assertEquals(BargeIn.Stop, BargeInDetector.classify("Pará", speaking, final = false))
        assertEquals(BargeIn.Stop, BargeInDetector.classify("Esperá NEXUS", speaking, final = true))
        assertEquals(BargeIn.Resume, BargeInDetector.classify("continuá", null, final = true))
        assertEquals(BargeIn.None, BargeInDetector.classify("la capital de Australia", speaking, final = true)) // eco del TTS
        assertTrue(BargeInDetector.classify("Eso no es lo que quería", speaking, final = true) is BargeIn.Stop)
        assertTrue(BargeInDetector.classify("mejor contame de Marte", speaking, final = true) is BargeIn.NewInstruction)
        assertEquals(BargeIn.None, BargeInDetector.classify("mejor", speaking, final = false))
    }

    @Test fun `speech text drops markdown and links`() {
        val s = SpeechText.sentences("# Título\n**Hola**. Mirá https://x.com/a y `code`. ¿Seguimos?")
        assertEquals(listOf("Título Hola.", "Mirá (enlace en pantalla) y code.", "¿Seguimos?"), s)
    }

    private class FakeRecognizer : Recognizer {
        override val available = true
        override var listener: RecognizerListener? = null
        var starts = 0
        override fun start(language: String, preferOffline: Boolean) { starts++ }
        override fun stop() = Unit
        override fun cancel() = Unit
        override fun destroy() = Unit
    }

    private class FakeSpeaker : Speaker {
        override val ready = true
        override var listener: SpeakerListener? = null
        val spoken = mutableListOf<String>()
        var stops = 0
        override fun speak(id: String, sentences: List<String>, prefs: VoicePrefs) { spoken += sentences.joinToString(" "); listener?.onStart(id) }
        override fun stop() { stops++ }
        override fun shutdown() = Unit
    }

    @Test fun `voice engine push to talk, continuous mode with retry cap and barge-in`() {
        val rec = FakeRecognizer()
        val tts = FakeSpeaker()
        val heard = mutableListOf<Triple<String, String?, Int?>>()
        val engine = VoiceEngine({ rec }, tts, { t, id, chars -> heard += Triple(t, id, chars) })

        // Pulsar para hablar: un toque abre el micrófono; el resultado se entrega una vez.
        engine.tapMic()
        assertTrue(engine.state.value.listening)
        rec.listener!!.onFinal("recordame comprar pan")
        assertEquals("recordame comprar pan", heard.single().first)
        assertFalse(engine.state.value.listening)

        // Modo continuo: tras hablar NEXUS se vuelve a escuchar; se reintenta como máximo 2 veces.
        engine.startSession(continuous = true)
        val startsBefore = rec.starts
        engine.speak("m1", "Listo. Te lo recuerdo mañana.")
        assertTrue(engine.state.value.speaking)
        tts.listener!!.onDone("m1")
        assertTrue(rec.starts > startsBefore)
        repeat(3) { rec.listener!!.onError(VoiceError.NO_MATCH, "") }
        assertFalse("el modo continuo no deja el micrófono abierto indefinidamente", engine.state.value.sessionActive)

        // Barge-in de un toque: si NEXUS habla, el toque lo calla y escucha.
        engine.startSession(continuous = true)
        engine.speak("m2", "Una respuesta muy larga que el usuario va a interrumpir.")
        tts.listener!!.onProgress("m2", 12)
        engine.tapMic()
        assertTrue(tts.stops > 0)
        assertTrue(engine.state.value.listening)

        // Barge-in por voz con una nueva instrucción: se entrega con el id interrumpido y lo dicho.
        engine.speak("m3", "Canberra es la capital de Australia.")
        tts.listener!!.onProgress("m3", 8)
        rec.listener!!.onFinal("mejor contame de Marte")
        val last = heard.last()
        assertEquals("mejor contame de Marte", last.first)
        assertEquals("m3", last.second)
        assertEquals(8, last.third)
        engine.endSession()
        assertFalse(engine.state.value.sessionActive)
    }

    private class MemoryContacts(val list: MutableList<SavedContact>) : ContactSource {
        override fun resolve(query: String) = ContactResolver.resolve(query, list)
        override fun save(contact: SavedContact) { list += contact }
        override fun markUsed(id: String) = Unit
    }

    @Test fun `whatsapp flow covers cancel, re-prepare, confirm and never says sent`() {
        val contacts = MemoryContacts(book.toMutableList())
        val flow = WhatsAppFlow(contacts)
        // 1-3: alias → contacto → borrador
        flow.start("a1", "papá", null, "Llego tarde")
        assertEquals("Papá", flow.draft.value.contact?.label)
        assertEquals(WaState.CONTACT_RESOLVED, flow.draft.value.state) // número sin código: requiere aceptar la suposición
        assertFalse(flow.draft.value.readyToConfirm)
        flow.acceptAssumptions()
        assertEquals(WaState.AWAITING_CONFIRMATION, flow.draft.value.state)
        assertEquals("+54 9 11 ****-6789", flow.draft.value.phone?.masked)
        // 4-5: vista previa y cancelación
        flow.cancel()
        assertEquals(WaState.CANCELLED, flow.draft.value.state)
        assertFalse(flow.confirmed())
        // 6: volver a preparar conserva destinatario y texto
        flow.reprepare()
        assertEquals("Llego tarde", flow.draft.value.text)
        assertTrue(flow.draft.value.readyToConfirm)
        // 7-8: confirmar y abrir
        assertTrue(flow.confirmed())
        assertEquals(WaState.READY_TO_OPEN, flow.draft.value.state)
        flow.opened()
        assertEquals(WaState.WHATSAPP_OPENED, flow.draft.value.state)
        // 10: el mensaje final no afirma un envío
        val msg = flow.statusMessage().lowercase()
        assertTrue(msg.contains("tocá enviar"))
        WaState.entries.forEach { assertFalse(it.name.contains("SENT")) }

        // Número ambiguo (sin código de área): se pregunta antes de seguir.
        val f2 = WhatsAppFlow(contacts)
        f2.start(null, null, "15 2345 6789", "hola")
        assertEquals("needs_area_code", f2.draft.value.phone?.status)
        assertFalse(f2.draft.value.readyToConfirm)
        f2.withAreaCode("11")
        f2.acceptAssumptions()
        assertTrue(f2.draft.value.readyToConfirm)

        // Contacto no guardado: se pide elegirlo y, si el usuario quiere, se recuerda con alias.
        val f3 = WhatsAppFlow(contacts)
        f3.start(null, "plomero", null, "")
        assertTrue(f3.draft.value.needsPick)
        f3.picked("Raúl Plomería", "011 15 4444-5555", "plomero")
        assertEquals(WaState.AWAITING_CONFIRMATION, f3.draft.value.state)
        assertTrue(contacts.list.any { "plomero" in it.aliases })
    }

    @Test fun `core visual state comes only from real signals`() {
        val online = ConnectionState.Connected
        assertEquals(CoreState.OFFLINE, coreStateOf(CoreSignals(ConnectionState.Disconnected, "thinking", listening = true)))
        assertEquals(CoreState.IDLE, coreStateOf(CoreSignals(online, "idle")))
        assertEquals(CoreState.LISTENING, coreStateOf(CoreSignals(online, "idle", listening = true)))
        assertEquals(CoreState.SPEAKING, coreStateOf(CoreSignals(online, "idle", speaking = true)))
        assertEquals(CoreState.THINKING, coreStateOf(CoreSignals(online, "thinking")))
        assertEquals(CoreState.THINKING, coreStateOf(CoreSignals(online, "idle", awaitingReply = true)))
        assertEquals(CoreState.COLLABORATING, coreStateOf(CoreSignals(online, "collaborating")))
        assertEquals(CoreState.EXECUTING, coreStateOf(CoreSignals(online, "executing")))
        assertEquals(CoreState.WAITING_CONFIRMATION, coreStateOf(CoreSignals(online, "idle", pendingConfirmations = 1)))
        assertEquals(CoreState.ERROR, coreStateOf(CoreSignals(online, "idle", recentError = true)))
    }

    @Test fun `routines show schedules in natural language`() {
        assertEquals("todos los días a las 08:00", ai.nexus.app.features.actions.humanCron("0 8 * * *"))
        assertEquals("los lunes a las 09:30", ai.nexus.app.features.actions.humanCron("30 9 * * 1"))
        assertEquals("cada 4 horas", ai.nexus.app.features.actions.humanCron("0 */4 * * *"))
        assertEquals("5 4 * 1 *", ai.nexus.app.features.actions.humanCron("5 4 * 1 *"))
    }

    @Test fun `realtime reconnection never delivers the same event twice`() {
        val d = EventDeduplicator(capacity = 3)
        assertTrue(d.firstTime("a"))
        assertFalse(d.firstTime("a"))
        listOf("b", "c", "d").forEach { assertTrue(d.firstTime(it)) }
        assertTrue(d.firstTime("a")) // fuera de la ventana
        assertTrue(d.firstTime(null))
    }
}

/** Los intents de Phone Control son los oficiales de Android (sin accesibilidad ni toques simulados). */
@RunWith(AndroidJUnit4::class)
@Config(application = TestNexusApp::class, sdk = [35])
class ActionIntentsTest {
    private val ctx = ApplicationProvider.getApplicationContext<TestNexusApp>()
    private fun p(vararg pairs: Pair<String, Any>) = JsonObject(pairs.associate { (k, v) ->
        k to when (v) { is Int -> JsonPrimitive(v); is Boolean -> JsonPrimitive(v); else -> JsonPrimitive(v.toString()) } })

    @Test fun `builds official intents for each device action`() {
        val (wa, waState) = ActionExecutor.buildIntent(ctx, "whatsapp.open_chat", p("phone" to "+54 9 11 2345-6789", "text" to "Llego tarde"))
        assertEquals("WHATSAPP_OPENED", waState)
        assertEquals("https://wa.me/5491123456789?text=Llego%20tarde", wa!!.data.toString())
        assertNull(ActionExecutor.buildIntent(ctx, "whatsapp.open_chat", p("phone" to "15 2345")).first)

        val (alarm, _) = ActionExecutor.buildIntent(ctx, "device.set_alarm", p("hour" to 7, "minute" to 30))
        assertEquals(AlarmClock.ACTION_SET_ALARM, alarm!!.action)
        assertEquals(7, alarm.getIntExtra(AlarmClock.EXTRA_HOUR, -1))
        assertFalse(alarm.getBooleanExtra(AlarmClock.EXTRA_SKIP_UI, true))

        val (event, _) = ActionExecutor.buildIntent(ctx, "device.calendar_event", p("title" to "Reunión", "start" to "2026-11-27T10:00:00-03:00",
            "end" to "2026-11-27T11:00:00-03:00"))
        assertEquals(Intent.ACTION_INSERT, event!!.action)
        assertEquals(1795784400000L, event.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0))

        val (bt, _) = ActionExecutor.buildIntent(ctx, "device.open_settings", p("panel" to "bluetooth"))
        assertEquals(Settings.ACTION_BLUETOOTH_SETTINGS, bt!!.action)
        val (nav, _) = ActionExecutor.buildIntent(ctx, "device.navigate", p("destination" to "Plaza de Mayo", "mode" to "walking"))
        assertTrue(nav!!.data.toString().contains("destination=Plaza+de+Mayo&travelmode=walking"))
        val (dial, _) = ActionExecutor.buildIntent(ctx, "device.dial", p("phone" to "+5491123456789"))
        assertEquals(Intent.ACTION_DIAL, dial!!.action)
        assertEquals(null to "ERROR", ActionExecutor.buildIntent(ctx, "device.open_url", p("url" to "http://inseguro.test")))
        assertEquals("APP_NOT_FOUND", ActionExecutor.buildIntent(ctx, "device.open_app", p("app" to "AppQueNoExiste")).second)
        assertEquals(android.provider.MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA, ActionExecutor.buildIntent(ctx, "device.open_app", p("app" to "la cámara")).first!!.action)
    }
}
