package ai.nexus.app.data.cache

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/** Última respuesta conocida de cada pantalla: permite abrir la app sin conexión. */
@Entity(tableName = "cached_responses")
data class CachedResponse(
    @PrimaryKey val key: String,
    val json: String,
    val updatedAt: Long,
)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cached_responses WHERE `key` = :key")
    suspend fun get(key: String): CachedResponse?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun put(entry: CachedResponse)

    @Query("DELETE FROM cached_responses")
    suspend fun clear()
}

@Database(entities = [CachedResponse::class], version = 1, exportSchema = true)
abstract class CacheDb : RoomDatabase() {
    abstract fun cache(): CacheDao

    companion object {
        fun create(context: Context): CacheDb =
            Room.databaseBuilder(context, CacheDb::class.java, "nexus_cache.db").fallbackToDestructiveMigration(true).build()
    }
}
