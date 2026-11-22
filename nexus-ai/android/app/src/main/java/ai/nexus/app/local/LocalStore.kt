package ai.nexus.app.local

import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.data.model.*
import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.util.UUID

/**
 * Base de datos local (SQLite) del modo sin servidor: documentos JSON por colección.
 * Todo queda dentro del teléfono; se borra al desinstalar la app.
 */
class LocalStore(context: Context, name: String = "nexus_local.db") : SQLiteOpenHelper(context, name, null, 1) {
    private val cache = HashMap<String, LinkedHashMap<String, String>>()
    private var seq = 0L

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE docs (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (coll, id))")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    private fun coll(c: String): LinkedHashMap<String, String> = cache.getOrPut(c) {
        val map = LinkedHashMap<String, String>()
        readableDatabase.rawQuery("SELECT id, data, seq FROM docs WHERE coll = ? ORDER BY seq", arrayOf(c)).use { cur ->
            while (cur.moveToNext()) { map[cur.getString(0)] = cur.getString(1); seq = maxOf(seq, cur.getLong(2)) }
        }
        if (seq == 0L) readableDatabase.rawQuery("SELECT MAX(seq) FROM docs", null).use { if (it.moveToFirst()) seq = it.getLong(0) }
        map
    }

    @Synchronized fun <T> get(c: String, id: String, ser: KSerializer<T>): T? = coll(c)[id]?.let { NexusJson.decodeFromString(ser, it) }

    @Synchronized fun <T> all(c: String, ser: KSerializer<T>): List<T> = coll(c).values.map { NexusJson.decodeFromString(ser, it) }

    @Synchronized fun <T> put(c: String, id: String, ser: KSerializer<T>, value: T) {
        val text = NexusJson.encodeToString(ser, value)
        val map = coll(c)
        val existing = map.containsKey(id)
        map[id] = text
        val cv = ContentValues().apply { put("coll", c); put("id", id); put("data", text) }
        if (existing) writableDatabase.update("docs", cv, "coll = ? AND id = ?", arrayOf(c, id))
        else { cv.put("seq", ++seq); writableDatabase.insertWithOnConflict("docs", null, cv, SQLiteDatabase.CONFLICT_REPLACE) }
    }

    @Synchronized fun delete(c: String, id: String) {
        coll(c).remove(id)
        writableDatabase.delete("docs", "coll = ? AND id = ?", arrayOf(c, id))
    }

    @Synchronized fun count(c: String) = coll(c).size

    @Synchronized fun dump(): Map<String, List<String>> {
        val out = HashMap<String, List<String>>()
        readableDatabase.rawQuery("SELECT DISTINCT coll FROM docs", null).use { while (it.moveToNext()) out[it.getString(0)] = coll(it.getString(0)).values.toList() }
        return out
    }

    @Synchronized fun wipe() {
        writableDatabase.delete("docs", null, null)
        cache.clear()
    }
}

fun newId(): String = UUID.randomUUID().toString()
fun nowIso(): String = Instant.now().toString()

// ------------------------------------------------------------ registros locales (DTO + datos internos)

@Serializable data class LocalUser(val id: String, val email: String, val name: String)

@Serializable data class LocalSettings(
    val settings: SettingsDto = SettingsDto(),
    val jarvis: JsonObject = JsonObject(emptyMap()),
    val privacy: JsonObject = JsonObject(emptyMap()),
    val voice: VoicePrefs = VoicePrefs(),
    val lastSeenAt: String? = null,
)

@Serializable data class AgentRec(val d: AgentDetailDto, val versions: List<InstructionVersion> = emptyList())
@Serializable data class ProviderRec(val p: ProviderDto, val keyEnc: String? = null)
@Serializable data class ConvRec(val c: ConversationDto, val kind: String = "chat", val summary: String? = null)
@Serializable data class ActionRec(val a: ActionDto, val phoneEnc: String? = null, val userId: String = "")
@Serializable data class MemoryRec(val m: MemoryDto, val category: String = "general", val lastVerifiedAt: String? = null, val updatedAt: String? = null)
@Serializable data class AutomationRec(val a: AutomationDto, val runTimes: List<String> = emptyList(), val createdAt: String = nowIso())
@Serializable data class RunRec(val automationId: String, val r: AutomationRunDto)
@Serializable data class MissionRec(val m: MissionDetailDto, val updatedAt: String, val error: String? = null, val agentIds: List<String> = emptyList())
@Serializable data class MeetingRec(val d: MeetingDetailDto, val projectId: String? = null, val startedAt: String? = null, val endedAt: String? = null, val tokens: Int = 0)
@Serializable data class FileRec(val f: ProjectFileDto, val localPath: String)
@Serializable data class UsageRec(val id: String, val at: String, val model: String, val purpose: String, val tokensIn: Int, val tokensOut: Int, val estimated: Boolean)
@Serializable data class CrashRec(val id: String, val at: String, val body: CrashBody)

object C {
    const val META = "meta"
    const val AGENTS = "agents"
    const val PROVIDERS = "providers"
    const val MODELS = "models"
    const val CONVS = "conversations"
    const val MSGS = "messages"
    const val ACTIONS = "actions"
    const val MEMORY = "memory"
    const val NOTIFS = "notifications"
    const val ACTIVITY = "activity"
    const val SCHEDULES = "schedules"
    const val AUTOS = "automations"
    const val RUNS = "automation_runs"
    const val MISSIONS = "missions"
    const val TASKS = "tasks"
    const val MEETINGS = "meetings"
    const val PROJECTS = "projects"
    const val FILES = "files"
    const val USAGE = "usage"
    const val CRASHES = "crashes"
}
