import { useEffect, useState } from 'react';
import { Button } from '../../../components/common/Button';
import { Switch } from '../../../components/common/Switch';
import { productAnalyticsService } from '../../../services/productAnalytics.service';
import type { ProductMetricsSummary } from '../../../services/productAnalytics.service';
import { SettingsSection } from './SettingsSection';
import { downloadTextFile } from '../../../services/fileTransfer.service';
import styles from './ProductAnalyticsSection.module.css';

const EMPTY: ProductMetricsSummary = {
  trip_created: 0,
  place_added: 0,
  booking_saved: 0,
  return_visit: 0,
  returnDays: 0,
  since: null,
};

export function ProductAnalyticsSection() {
  const [consented, setConsented] = useState(productAnalyticsService.isConsented());
  const [summary, setSummary] = useState<ProductMetricsSummary>(() => productAnalyticsService.getSummary());

  useEffect(() => productAnalyticsService.subscribe(() => {
    setConsented(productAnalyticsService.isConsented());
    setSummary(productAnalyticsService.getSummary());
  }), []);

  function changeConsent(value: boolean) {
    productAnalyticsService.setConsent(value);
    setConsented(value);
    setSummary(productAnalyticsService.getSummary());
  }

  return (
    <SettingsSection
      title="Usage metrics"
      description="Optional, on-device product measurement. Nothing is sent to us. Metrics never include prompts, destinations, booking references, prices, or account details, and are kept on this device for up to 90 days."
    >
      <Switch
        label="Measure anonymous usage on this device"
        description="Counts trips created, places added, bookings saved, and days you return. Off by default."
        checked={consented}
        onChange={changeConsent}
      />
      {consented ? (
        <div className={styles.metrics} aria-label="Usage metrics stored on this device">
          <Metric label="Trips created" value={summary.trip_created} />
          <Metric label="Places added" value={summary.place_added} />
          <Metric label="Bookings saved" value={summary.booking_saved} />
          <Metric label="Days returned" value={summary.returnDays} />
          {summary.since ? <p className={styles.since}>Measured since {new Date(summary.since).toLocaleDateString()}.</p> : null}
          <Button variant="secondary" size="md" onClick={() => {
            productAnalyticsService.clear();
            setSummary(EMPTY);
          }}>
            Clear metrics on this device
          </Button>
          <Button variant="secondary" size="md" onClick={() => {
            downloadTextFile('ai-travel-usage-metrics.json', productAnalyticsService.exportJson(), 'application/json');
          }}>
            Export metrics
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <p className={styles.metric}><span>{label}</span><strong>{value}</strong></p>;
}
