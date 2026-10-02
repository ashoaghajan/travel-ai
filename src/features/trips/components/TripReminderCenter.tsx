import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Switch } from '../../../components/common/Switch';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { settingsService } from '../../../services/settings.service';
import { deliverBrowserReminders, getTripReminders, requestBrowserNotificationPermission } from '../../../services/tripReminder.service';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import { useTrips } from '../../../store/trip.store';
import { useBookings } from '../../../store/booking.store';
import styles from './TripReminderCenter.module.css';

export function TripReminderCenter() {
  const trips = useTrips();
  const bookings = useBookings();
  const { isAuthenticated } = useCurrentUser();
  const isOnline = useOnlineStatus();
  const [enabled, setEnabled] = useState(() => settingsService.getSettings().notifications.tripReminders);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => settingsService.subscribe(() => {
    setEnabled(settingsService.getSettings().notifications.tripReminders);
  }), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const reminders = useMemo(
    () => getTripReminders(trips, bookings, now),
    [trips, bookings, now],
  );

  useEffect(() => {
    if (!enabled || !isOnline || !isAuthenticated || permission !== 'granted') return;
    deliverBrowserReminders(reminders);
  }, [enabled, isOnline, isAuthenticated, permission, reminders]);

  const hasBrowserNotifications = typeof Notification !== 'undefined';
  const notificationPermission = hasBrowserNotifications ? Notification.permission : 'unsupported';

  async function enableBrowserNotifications() {
    const result = await requestBrowserNotificationPermission();
    setPermission(result);
    setPermissionNote(
      result === 'granted'
        ? 'Browser alerts are enabled for upcoming trip reminders.'
        : result === 'unsupported'
          ? 'Browser notifications are unavailable here. Reminders remain visible in the app.'
          : 'Notifications were not allowed. Reminders remain visible in the app.',
    );
  }

  function setReminderPreference(next: boolean) {
    const previous = settingsService.getSettings().notifications;
    setEnabled(next);
    setPermissionNote(null);
    void settingsService.save({ notifications: { ...previous, tripReminders: next } })
      .then((settings) => setEnabled(settings.notifications.tripReminders))
      .catch(() => {
        setEnabled(previous.tripReminders);
        setPermissionNote('We could not save this reminder preference. Try again when you are online.');
      });
  }

  if (!enabled || reminders.length === 0) return null;

  return (
    <aside className={styles.center} aria-label="Trip reminders">
      <Card padding="md" elevation="soft" className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2>Trip reminders</h2>
            <p>
              Upcoming activities and trip details to finish.
              {notificationPermission === 'granted' ? ' Browser alerts are enabled.' : ''}
            </p>
          </div>
          <div className={styles.controls}>
            <Switch
              label="In-app reminders"
              checked={enabled}
              onChange={setReminderPreference}
            />
            {hasBrowserNotifications && permission !== 'granted' ? (
              <Button variant="secondary" size="md" onClick={() => void enableBrowserNotifications()}>
                {permission === 'denied' ? 'Notification settings' : 'Enable browser alerts'}
              </Button>
            ) : null}
          </div>
        </div>
        {permissionNote ? <p className={styles.note} role="status">{permissionNote}</p> : null}
        <ul className={styles.list}>
          {reminders.slice(0, 3).map((reminder) => (
            <li key={reminder.id}>
              <div>
                <strong>{reminder.title}</strong>
                <p>{reminder.detail}</p>
              </div>
              <Link to={reminder.href}>Open</Link>
            </li>
          ))}
        </ul>
      </Card>
    </aside>
  );
}
