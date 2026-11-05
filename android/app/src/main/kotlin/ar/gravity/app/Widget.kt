package ar.gravity.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Widget de la pantalla de inicio: cuántos compañeros trabajan y cuántas aprobaciones esperan. No consulta
 * nada por su cuenta: lo actualiza Motor.kt cada vez que le pregunta el estado al motor (cada 30 s mientras
 * corre). Tocarlo abre el Centro de operaciones.
 */
class Widget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, vistas(context, context.getString(R.string.widget_abrir)))
    }

    companion object {
        private var ultimo: String? = null

        fun actualizar(context: Context, trabajando: Int, aprobaciones: Int, ocupado: Boolean) {
            val texto = buildList {
                add(
                    when {
                        trabajando == 1 -> context.getString(R.string.widget_uno)
                        trabajando > 1 -> context.getString(R.string.widget_varios, trabajando)
                        ocupado -> context.getString(R.string.motor_ocupado)
                        else -> context.getString(R.string.widget_libres)
                    },
                )
                if (aprobaciones == 1) add(context.getString(R.string.aprobacion_una))
                else if (aprobaciones > 1) add(context.getString(R.string.aprobaciones, aprobaciones))
            }.joinToString(" · ")
            if (texto == ultimo) return
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, Widget::class.java))
            if (ids.isEmpty()) return
            ultimo = texto
            manager.updateAppWidget(ids, vistas(context, texto))
        }

        private fun vistas(context: Context, texto: String): RemoteViews {
            val abrir = PendingIntent.getActivity(
                context,
                7,
                Intent(context, MainActivity::class.java)
                    .putExtra("ar.gravity.app.PANTALLA", "operaciones")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            return RemoteViews(context.packageName, R.layout.widget_gravity).apply {
                setTextViewText(R.id.widget_estado, texto)
                setOnClickPendingIntent(R.id.widget_raiz, abrir)
            }
        }
    }
}
