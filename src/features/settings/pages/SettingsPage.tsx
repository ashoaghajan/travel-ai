import { PageHeader } from '../../../components/layout/PageHeader';
import { CurrencySelect } from '../../../components/common/CurrencySelect';
import { Switch } from '../../../components/common/Switch';
import { settingsService } from '../../../services/settings.service';
import { useTrips } from '../../../store/trip.store';
import { formatBytes } from '../../../utils/bytes';
import { APPEARANCES } from '../../../types/settings.types';
import { PlanningSection } from '../components/PlanningSection';
import { SettingsSection } from '../components/SettingsSection';
import { ProductAnalyticsSection } from '../components/ProductAnalyticsSection';
import { useSettings } from '../useSettings';
import styles from './SettingsPage.module.css';

/** Friendlier names for the storage keys shown on this screen. */
/**
 * A readable name for every key the usage list can report.
 *
 * Partial, it turned out: `getStorageUsage` walks all of `STORAGE_KEYS`, so any
 * key missing here fell through to `?? entry.key` and the panel listed raw
 * internals — "ai-travel-planner:geocodes" — beside the six that had names.
 */
const STORAGE_LABELS: Record<string, string> = {
  'ai-travel-planner:trips': 'Saved trips',
  'ai-travel-planner:activeTripId': 'Active trip',
  'ai-travel-planner:chatHistory': 'Planner conversation',
  'ai-travel-planner:settings': 'Preferences',
  'ai-travel-planner:recentSearches': 'Recent searches',
  'ai-travel-planner:bookings': 'Bookings',
  'ai-travel-planner:selectedCountry': 'Chosen country',
  'ai-travel-planner:selectedCity': 'Chosen city',
  'ai-travel-planner:savedActivities': 'Saved attractions',
  'ai-travel-planner:messagesOpen': 'Messages panel',
  'ai-travel-planner:airports': 'Airport lookups',
  'ai-travel-planner:countries': 'Country list',
  'ai-travel-planner:activities': 'Attraction results',
  'ai-travel-planner:geocodes': 'Place coordinates',
  'ai-travel-planner:exchangeRates': 'Exchange rates',
  'ai-travel-planner:migratedFor': 'Migration record',
  'ai-travel-planner:ownerUserId': 'Signed-in account',
  'ai-travel-planner:reminderDeliveries': 'Reminder deliveries',
  'ai-travel-planner:offlineTrips': 'Offline trip copies',
  'ai-travel-planner:offlineBookings': 'Offline booking copies',
  'ai-travel-planner:offlineUser': 'Offline account profile',
  'ai-travel-planner:productAnalyticsConsent': 'Product measurement preference',
  'ai-travel-planner:productAnalytics': 'Product measurements',
};

export function SettingsPage() {
  const { settings, error, update, setNotification, setTravel } = useSettings();

  /*
   * Read off the document rather than from `matchMedia`, so the swatches agree
   * with the page around them even in the frame before an OS change has been
   * applied. `useAppliedTheme` is the only writer of this attribute.
   */
  const ground = document.documentElement.dataset.theme ?? 'light';
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
          description="Three looks for the same app. Light and dark follow your device."
        >
          <fieldset className={styles.fieldset}>
            <legend className="visually-hidden">Appearance</legend>
            {/*
              Stacked rather than segmented: each option carries a line of
              description, and three of those will not sit side by side on a
              phone-width column. The swatch is the useful part — it is painted
              from the option's own tokens, so it previews the look rather than
              describing it.
            */}
            <div className={styles.appearances}>
              {APPEARANCES.map((option) => (
                <label
                  key={option.id}
                  className={styles.appearance}
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
                  {/*
                    Carries the ground as well as the look, so the preview
                    shows what the reader would actually get rather than always
                    the light version. `data-theme` on a nested element selects
                    the same block the document element does — see the note in
                    `tokens.css` about these selectors not being pinned to
                    `:root`.
                  */}
                  <span
                    className={styles.swatch}
                    data-appearance={option.id}
                    data-theme={ground}
                    aria-hidden="true"
                  >
                    <span className={styles.swatchFill} />
                    <span className={styles.swatchLine} />
                    <span className={styles.swatchLine} data-short="true" />
                  </span>
                  <span className={styles.appearanceText}>
                    <span className={styles.appearanceLabel}>{option.label}</span>
                    <span className={styles.appearanceDescription}>{option.description}</span>
                  </span>
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

        {/*
          Above notifications, below currency: this is the section that changes
          what the app produces rather than how it looks, and it is the one
          somebody arrives here to find.
        */}
        <PlanningSection travel={settings.travel} onChange={setTravel} />

        <SettingsSection
          title="Notifications"
          description="Upcoming activities and trip-readiness reminders appear in the app. Browser notifications are optional and only requested when you enable them."
        >
          <Switch
            label="Trip reminders"
            description="Upcoming activities, hotel check-in dates, and trip details to finish."
            checked={settings.notifications.tripReminders}
            onChange={(checked) => setNotification('tripReminders', checked)}
          />
          <Switch
            label="Price alerts"
            description="Unavailable until a reliable live fare and stay tracking provider is connected."
            checked={settings.notifications.priceAlerts}
            onChange={(checked) => setNotification('priceAlerts', checked)}
            disabled
          />
        </SettingsSection>

        <ProductAnalyticsSection />

        <SettingsSection
          title="Storage"
          description="What this browser is keeping on the device itself. Your trips and preferences live on your account, so they are not counted here."
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
