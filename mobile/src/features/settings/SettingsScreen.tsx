import { useState } from 'react';
import { Pressable, Switch, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { STORAGE_KEYS, storageService } from '../../core/services/localStorage.service';
import { setDisplayCurrency, useDisplayCurrency } from '../../core/store/currency.store';
import { useTrips } from '../../core/store/trip.store';
import { formatBytes } from '../../core/utils/bytes';
import type { Appearance } from '../../core/types/settings.types';
import { APPEARANCES } from '../../core/types/settings.types';
import { ArrowLeftIcon } from '../../components/icons';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { themeFor } from '../../theme/tokens';
import { CurrencyPicker } from './CurrencyPicker';
import { SettingsSection } from './SettingsSection';
import { useSettings } from './useSettings';

/**
 * Friendlier names for the storage keys shown on this screen.
 *
 * **Every key, where the web labels six of them.** The web's map falls back to
 * printing the raw key, which is survivable in a desktop table and is not on a
 * phone — `ai-travel-planner:geocodes` in a 360dp column wraps to two lines and
 * tells the reader nothing. The keys are listed in `STORAGE_KEYS` order so the
 * rows do not reshuffle as caches fill.
 */
const STORAGE_LABELS: Record<string, string> = {
  [STORAGE_KEYS.trips]: 'Saved trips',
  [STORAGE_KEYS.activeTripId]: 'Active trip',
  [STORAGE_KEYS.chatHistory]: 'Planner conversation',
  [STORAGE_KEYS.settings]: 'Preferences',
  [STORAGE_KEYS.recentSearches]: 'Recent searches',
  [STORAGE_KEYS.selectedCountry]: 'Explorer country',
  [STORAGE_KEYS.selectedCity]: 'Explorer city',
  [STORAGE_KEYS.savedActivities]: 'Saved attractions',
  [STORAGE_KEYS.messagesOpen]: 'Messages panel',
  [STORAGE_KEYS.bookings]: 'Bookings',
  [STORAGE_KEYS.airports]: 'Airports',
  [STORAGE_KEYS.countries]: 'Countries',
  [STORAGE_KEYS.activities]: 'Attractions cache',
  [STORAGE_KEYS.geocodes]: 'Map locations',
  [STORAGE_KEYS.exchangeRates]: 'Exchange rates',
  [STORAGE_KEYS.migratedFor]: 'Migration marker',
  [STORAGE_KEYS.ownerUserId]: 'Account marker',
};

/** The three-way theme choice — the web's segmented radio group. */
function ThemeSegments({
  value,
  onChange,
}: {
  value: Appearance;
  onChange: (next: Appearance) => void;
}) {
  const theme = useTheme();

  return (
    /*
      Stacked rows, where this was a segmented control.
      
      Three names with a line of description each will not fit across a 360dp
      phone, and the descriptions are what make the choice make sense — "Atlas"
      on its own tells nobody anything. The web picker made the same call for
      the same reason.
    */
    <View style={{ gap: theme.space.sm }}>
      {APPEARANCES.map((option) => {
        const isSelected = value === option.id;

        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={option.label}
            accessibilityHint={option.description}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.lg,
              paddingVertical: theme.space.md,
              paddingHorizontal: theme.space.lg,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: isSelected ? theme.color.accent : theme.color.border,
              backgroundColor: isSelected ? theme.color.primarySoft : 'transparent',
            }}
          >
            <AppearanceSwatch appearance={option.id} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="md" weight={isSelected ? 'semibold' : 'medium'}>
                {option.label}
              </Text>
              <Text variant="xs" tone="muted" leading="snug">
                {option.description}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A miniature of one look, painted from that look's own palette.
 *
 * `themeFor` is called directly rather than reading the active theme, which is
 * the whole point: the swatch shows what the reader would be switching *to*,
 * not what they are on. The ground is taken from the current theme so the
 * three sit honestly beside each other on one screen.
 */
function AppearanceSwatch({ appearance }: { appearance: Appearance }) {
  const current = useTheme();
  const preview = themeFor(appearance, current.scheme);

  return (
    <View
      style={{
        width: 56,
        height: 40,
        borderRadius: preview.radius.sm,
        borderWidth: 1,
        borderColor: preview.color.border,
        backgroundColor: preview.color.background,
        overflow: 'hidden',
      }}
    >
      <View style={{ height: 14, backgroundColor: preview.color.primary }} />
      <View style={{ flex: 1, justifyContent: 'flex-end', padding: 6, gap: 4 }}>
        <View style={{ height: 3, borderRadius: 999, backgroundColor: preview.color.textMuted }} />
        <View
          style={{
            height: 3,
            width: '60%',
            borderRadius: 999,
            backgroundColor: preview.color.textMuted,
          }}
        />
      </View>
    </View>
  );
}

/** One labelled switch with a line of explanation under it. */
function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="sm" weight="medium" leading="tight">
          {label}
        </Text>
        <Text variant="xs" tone="muted" leading="snug">
          {description}
        </Text>
      </View>

      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: theme.color.surfaceMuted, true: theme.color.primary }}
      />
    </View>
  );
}

/**
 * Settings — the page the phone could not reach.
 *
 * A port of `src/features/settings/pages/SettingsPage.tsx`, section for
 * section: appearance, currency, notifications, storage. It is reached from
 * `ScreenHeader`'s gear rather than from a tab, because the bottom bar is
 * `BOTTOM_NAV` and Settings is deliberately not in it.
 *
 * **The storage figures describe this device only**, as they do on the web.
 * The preferences above them do not: those live on the account, so a currency
 * chosen here is the currency the laptop shows.
 */
export function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { settings, error, update, setNotification } = useSettings();
  const currency = useDisplayCurrency();
  const trips = useTrips();
  const [pickingCurrency, setPickingCurrency] = useState(false);

  // Cheap enough to read on every render, and the trip store re-renders this
  // screen whenever the stored data actually changes.
  const usage = storageService.usage();
  const totalBytes = usage.reduce((total, entry) => total + entry.bytes, 0);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeftIcon size={22} color={theme.color.textMuted} />
        </TouchableOpacity>

        <Text variant="xl" weight="bold" leading="tight" style={{ flex: 1 }}>
          Settings
        </Text>
      </View>

      {error ? (
        <Text variant="sm" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <SettingsSection
        title="Appearance"
        description="Three looks for the same app. Light and dark follow your device."
      >
        <ThemeSegments value={settings.theme} onChange={(next) => void update({ theme: next })} />
      </SettingsSection>

      <SettingsSection
        title="Currency"
        description="Prices are quoted in US dollars and converted for display. Rates refresh daily."
      >
        <Pressable
          onPress={() => setPickingCurrency(true)}
          accessibilityRole="button"
          accessibilityLabel={`Show prices in ${currency}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            backgroundColor: theme.color.surfaceMuted,
            borderRadius: theme.radius.md,
            paddingVertical: theme.space.md,
            paddingHorizontal: theme.space.lg,
          }}
        >
          <Text variant="sm" tone="muted" style={{ flex: 1 }}>
            Show prices in
          </Text>
          <Text variant="sm" weight="semibold">
            {currency}
          </Text>
          <Text variant="sm" tone="muted">
            ›
          </Text>
        </Pressable>
      </SettingsSection>

      <SettingsSection
        title="Notifications"
        description="Nothing is sent in this version. Preferences are stored for later."
      >
        <ToggleRow
          label="Trip reminders"
          description="A nudge before a saved trip starts."
          value={settings.notifications.tripReminders}
          onChange={(checked) => setNotification('tripReminders', checked)}
        />
        <ToggleRow
          label="Price alerts"
          description="Tell me when flights or stays on a saved trip change price."
          value={settings.notifications.priceAlerts}
          onChange={(checked) => setNotification('priceAlerts', checked)}
        />
      </SettingsSection>

      {/*
        The web says "Everything you save stays in this browser. Nothing is
        uploaded." That sentence predates the account: trips and preferences
        are server-backed now, and this screen makes the contradiction visible
        — "Saved trips" reads 0 B on a phone showing four of them, because what
        is on the device is a cache and the trips themselves are on the
        account. So this describes what the figures actually are.
      */}
      <SettingsSection
        title="Storage"
        description="What this app is keeping on the phone itself. Your trips and preferences live on your account, so they are not counted here."
      >
        {usage.map((entry) => (
          <View
            key={entry.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}
          >
            <Text variant="xs" tone="muted" style={{ flex: 1 }}>
              {STORAGE_LABELS[entry.key] ?? entry.key}
              {entry.present ? '' : ' — not used yet'}
            </Text>
            <Text variant="xs" weight="medium">
              {formatBytes(entry.bytes)}
            </Text>
          </View>
        ))}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.md,
            borderTopColor: theme.color.border,
            borderTopWidth: 1,
            paddingTop: theme.space.md,
          }}
        >
          <Text variant="xs" weight="semibold" style={{ flex: 1 }}>
            Total — {trips.length} saved {trips.length === 1 ? 'trip' : 'trips'}
          </Text>
          <Text variant="xs" weight="semibold">
            {formatBytes(totalBytes)}
          </Text>
        </View>
      </SettingsSection>

      <Text variant="xs" tone="muted" leading="snug">
        Preferences are saved to your account, so they follow you to the web app too.
      </Text>

      {pickingCurrency ? (
        <CurrencyPicker
          selected={currency}
          onSelect={(code) => {
            setDisplayCurrency(code);
            setPickingCurrency(false);
          }}
          onClose={() => setPickingCurrency(false)}
        />
      ) : null}
    </Screen>
  );
}
