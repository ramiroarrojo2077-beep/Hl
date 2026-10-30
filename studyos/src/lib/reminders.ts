import { isNative } from './platform';
import { db, type CalendarEvent } from './db';

// Recordatorios: en Android usan notificaciones locales del sistema (llegan
// aunque la app esté cerrada). En el navegador solo pueden mostrarse mientras
// StudyOS está abierto, con la API de notificaciones.

const webTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notifId(eventId: string) {
  let h = 0;
  for (let i = 0; i < eventId.length; i++) h = (Math.imul(31, h) + eventId.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (isNative) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
    return p.display === 'granted';
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export async function scheduleReminder(ev: CalendarEvent): Promise<boolean> {
  await cancelReminder(ev);
  if (ev.reminderMinutes === undefined || ev.done) return false;
  const at = ev.start - ev.reminderMinutes * 60_000;
  if (at <= Date.now()) return false;
  if (!(await ensureNotificationPermission())) return false;
  const body = ev.reminderMinutes === 0 ? 'Empieza ahora' : `Empieza en ${ev.reminderMinutes} minutos`;
  if (isNative) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const id = notifId(ev.id);
    await LocalNotifications.schedule({ notifications: [{ id, title: ev.title, body, schedule: { at: new Date(at), allowWhileIdle: true } }] });
    await db.events.update(ev.id, { notificationId: id });
    return true;
  }
  const delay = at - Date.now();
  if (delay < 2_147_000_000) webTimers.set(ev.id, setTimeout(() => new Notification(ev.title, { body, icon: './icon.svg' }), delay));
  return true;
}

export async function cancelReminder(ev: CalendarEvent) {
  const t = webTimers.get(ev.id);
  if (t) clearTimeout(t);
  webTimers.delete(ev.id);
  if (isNative && ev.notificationId !== undefined) {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: ev.notificationId }] }).catch(() => {});
  }
}

/** En el navegador, reprograma los recordatorios de las próximas 24 h al abrir la app. */
export async function restoreWebReminders() {
  if (isNative || !('Notification' in window) || Notification.permission !== 'granted') return;
  const evs = await db.events.where('start').between(Date.now(), Date.now() + 86_400_000).toArray();
  for (const e of evs) if (e.reminderMinutes !== undefined && !e.done) await scheduleReminder(e);
}
