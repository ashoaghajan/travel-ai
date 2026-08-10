import { PageHeader } from '../../../components/layout/PageHeader';
import { CurrencySelect } from '../../../components/common/CurrencySelect';
import { Switch } from '../../../components/common/Switch';
import { settingsService } from '../../../services/settings.service';
import { useTrips } from '../../../store/trip.store';
import { formatBytes } from '../../../utils/bytes';
import type { ThemePreference } from '../../../types/settings.types';
import { SettingsSection } from '../components/SettingsSection';
import { useSettings } from '../useSettings';
import styles from './SettingsPage.module.css';

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Friendlier names for the storage keys shown on this screen. */
const STORAGE_LABELS: Record<string, string> = {
  'ai-travel-planner:trips': 'Saved trips',
  'ai-travel-planner:activeTripId': 'Active trip',
  'ai-travel-planner:chatHistory': 'Planner conversation',
  'ai-travel-planner:settings': 'Preferences',
  'ai-travel-planner:recentSearches': 'Recent searches',
  'ai-travel-planner:bookings': 'Bookings',
};

export function SettingsPage() {
  const { settings, error, update, setNotification } = useSettings();
  const trips = useTrips();

  // Five `getItem` calls — cheap enough to read on every render, and the trip
  // store re-renders this page whenever the stored data actually changes.
  const usage = settingsService.getStorageUsage();
  const totalBytes = usage.reduce((total, entry) => total + entry.bytes, 0);

  return (
    <div className={styles.page}>
      <PageHeader title="Settings" />

      <div className={styles.content}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <SettingsSection
          title="Appearance"
          description="System follows your device's light or dark setting, and changes with it."
        >
          <fieldset className={styles.fieldset}>
            <legend className="visually-hidden">Theme preference</legend>
            <div className={styles.segmented}>
              {THEME_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={styles.segment}
                  data-checked={settings.theme === option.id}
                >
                  <input
                    type="radio"
                    name="theme"
                    className="visually-hidden"
                    value={option.id}
                    checked={settings.theme === option.id}
                    onChange={() => update({ theme: option.id })}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </SettingsSection>

        <SettingsSection
          title="Currency"
          description="Prices are quoted in US dollars and converted for display. Rates refresh daily."
        >
          <CurrencySelect variant="field" label="Show prices in" />
        </SettingsSection>

        <SettingsSection
          title="Notifications"
          description="Nothing is sent in this version. Preferences are stored for later."
        >
          <Switch
            label="Trip reminders"
            description="A nudge before a saved trip starts."
            checked={settings.notifications.tripReminders}
            onChange={(checked) => setNotification('tripReminders', checked)}
          />
          <Switch
            label="Price alerts"
            description="Tell me when flights or stays on a saved trip change price."
            checked={settings.notifications.priceAlerts}
            onChange={(checked) => setNotification('priceAlerts', checked)}
          />
        </SettingsSection>

        <SettingsSection
          title="Storage"
          description="Everything you save stays in this browser. Nothing is uploaded."
        >
          <dl className={styles.usage}>
            {usage.map((entry) => (
              <div key={entry.key} className={styles.usageRow}>
                <dt className={styles.usageLabel}>
                  {STORAGE_LABELS[entry.key] ?? entry.key}
                  {entry.present ? null : <span className={styles.unused}>not used yet</span>}
                </dt>
                <dd className={styles.usageValue}>{formatBytes(entry.bytes)}</dd>
              </div>
            ))}

            <div className={`${styles.usageRow} ${styles.usageTotal}`}>
              <dt className={styles.usageLabel}>
                Total — {trips.length} saved {trips.length === 1 ? 'trip' : 'trips'}
              </dt>
              <dd className={styles.usageValue}>{formatBytes(totalBytes)}</dd>
            </div>
          </dl>
        </SettingsSection>

        <p className={styles.footnote}>
          Preferences are saved to <code className={styles.code}>ai-travel-planner:settings</code>{' '}
          on this device.
        </p>
      </div>
    </div>
  );
}
