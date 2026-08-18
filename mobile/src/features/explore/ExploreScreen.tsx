import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { CompassIcon } from '../../components/icons';
import { flagOf } from '../../core/utils/flag';
import { useTheme } from '../../theme/useTheme';
import { ActivityCard } from './ActivityCard';
import { CountryPicker } from './CountryPicker';
import {
  ACTIVITY_CHIPS,
  ALL_ACTIVITIES,
  categoryLabel,
  filterActivitiesByCategory,
} from './activity.filters';
import type { ActivityFilterId } from './activity.filters';
import { useExplore } from './useExplore';

/** How many cities the type-ahead offers at once. */
const CITY_SUGGESTIONS = 8;

/**
 * Screen 6 — the activities explorer, driven by country and city.
 *
 * `useExplore` and everything under it is the web's own code, so what is
 * written here is only how a phone shows it. Three things had to change:
 *
 * - **The country `<select>` becomes a sheet** — see `CountryPicker`.
 * - **The city `<datalist>` becomes a suggestion list.** RN has no combobox, so
 *   the matches are drawn under the field as rows. Eight rather than the web's
 *   fifty: a dropdown the reader scrolls past is fine, a list that pushes the
 *   Explore button off the screen is not.
 * - **The chip is local state, not a URL parameter.** The web keeps it in the
 *   query string so a filtered view can be linked and survives reload; nobody
 *   links to a tab, and the tab keeps its state while the app is alive anyway.
 *
 * **The list scrolls itself.** `Screen` is given `scroll={false}` and the
 * `FlatList` takes the selection and the chips as its header, because a list
 * inside a `ScrollView` gets an unbounded height and renders every row it has
 * — which is the whole pool for a big city, with a photo each.
 */
export function ExploreScreen() {
  const theme = useTheme();
  const {
    countries,
    cities,
    selection,
    selectionSource,
    tripCity,
    canFollowTrip,
    activities,
    exploredCity,
    isLoadingCountries,
    isLoadingCities,
    isLoadingActivities,
    isLoadingMore,
    countriesError,
    citiesError,
    activitiesError,
    hasMore,
    selectCountry,
    selectCity,
    explore,
    followTrip,
    loadMore,
    filterCities,
  } = useExplore();

  const [isPickingCountry, setIsPickingCountry] = useState(false);

  /*
   * The city box is a draft until Explore is pressed, and the prompt below has
   * to read it too — otherwise it goes on asking for a city that is already
   * typed.
   *
   * The committed destination seeds the draft and reclaims it whenever it
   * changes underneath — a trip opened elsewhere, or the country being
   * swapped, which invalidates a typed city as surely as a new one does. It is
   * adjusted during render rather than in an effect so the box never paints a
   * frame holding a city from the country before.
   */
  const destination = `${selection.countryCode ?? ''}|${selection.city ?? ''}`;
  const [cityDraft, setCityDraft] = useState(selection.city ?? '');
  const [lastDestination, setLastDestination] = useState(destination);
  /** Suppressed after a suggestion is taken, so the list does not reopen under the thumb. */
  const [isTyping, setIsTyping] = useState(false);

  if (destination !== lastDestination) {
    setLastDestination(destination);
    setCityDraft(selection.city ?? '');
    setIsTyping(false);
  }

  const [activeCategory, setActiveCategory] = useState<ActivityFilterId>(ALL_ACTIVITIES);

  const visible = useMemo(
    () => filterActivitiesByCategory(activities, activeCategory),
    [activities, activeCategory],
  );

  const suggestions = useMemo(
    () => (isTyping && cities.length > 0 ? filterCities(cityDraft, CITY_SUGGESTIONS) : []),
    [isTyping, cities.length, filterCities, cityDraft],
  );

  function exploreCity(city: string) {
    const next = city.trim();
    if (!next) return;

    setIsTyping(false);
    selectCity(next);
    explore(next);
  }

  const hasExplored = exploredCity !== null;
  const typedCity = cityDraft.trim() || null;
  const canExplore = typedCity !== null && !isLoadingActivities;

  const header = (
    <View style={{ gap: theme.space.md }}>
      <View style={{ gap: 4 }}>
        <Text variant="xl" weight="bold" leading="tight">
          {exploredCity ? `Top Activities in ${exploredCity}` : 'Explore Activities'}
        </Text>
        {selectionSource === 'trip' && exploredCity ? (
          <Text variant="sm" tone="muted" leading="snug">
            Following your trip to {exploredCity}
          </Text>
        ) : null}
      </View>

      <Card padding="lg" elevation="soft">
        <View style={{ gap: theme.space.md }}>
          <View style={{ gap: theme.space.xs }}>
            <Text variant="xs" weight="semibold" tone="muted" leading="tight">
              COUNTRY
            </Text>
            <Pressable
              onPress={() => setIsPickingCountry(true)}
              disabled={isLoadingCountries || countries.length === 0}
              accessibilityRole="button"
              accessibilityLabel="Choose a country"
              style={({ pressed }) => [
                {
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: theme.space.lg,
                  borderRadius: theme.radius.lg,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.background,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                variant="sm"
                tone={selection.countryName ? 'main' : 'muted'}
                leading="tight"
                numberOfLines={1}
              >
                {isLoadingCountries
                  ? 'Loading countries…'
                  : selection.countryName
                    ? `${selection.countryCode ? `${flagOf(selection.countryCode)} ` : ''}${selection.countryName}`
                    : 'Choose a country'}
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: theme.space.xs }}>
            <Text variant="xs" weight="semibold" tone="muted" leading="tight">
              CITY
            </Text>
            <TextInput
              style={{
                minHeight: 44,
                paddingHorizontal: theme.space.lg,
                borderRadius: theme.radius.lg,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: theme.color.background,
                color: theme.color.textMain,
                fontSize: theme.fontSize.sm,
              }}
              value={cityDraft}
              onChangeText={(next) => {
                setCityDraft(next);
                setIsTyping(true);
              }}
              onSubmitEditing={() => exploreCity(cityDraft)}
              editable={Boolean(selection.countryName) && !isLoadingCities}
              placeholder={cityPlaceholder(selection.countryName, cities.length, isLoadingCities)}
              placeholderTextColor={theme.color.textMuted}
              accessibilityLabel="City"
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="search"
            />

            {suggestions.length > 0 ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.color.background,
                  overflow: 'hidden',
                }}
              >
                {suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    onPress={() => {
                      setCityDraft(suggestion);
                      exploreCity(suggestion);
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      { paddingHorizontal: theme.space.lg, paddingVertical: theme.space.md },
                      pressed && { backgroundColor: theme.color.primarySoft },
                    ]}
                  >
                    <Text variant="sm" leading="tight">
                      {suggestion}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          <Button
            fullWidth
            disabled={!canExplore}
            loading={isLoadingActivities}
            onPress={() => exploreCity(cityDraft)}
          >
            Explore
          </Button>

          {canFollowTrip && tripCity ? (
            <Text variant="xs" tone="muted" leading="snug">
              Your trip goes to {tripCity}.{' '}
              <Text variant="xs" tone="primary" weight="semibold" onPress={followTrip}>
                Explore {tripCity} instead
              </Text>
            </Text>
          ) : null}
        </View>
      </Card>

      {countriesError ? <Problem message={countriesError} /> : null}
      {citiesError ? <Problem message={citiesError} /> : null}

      {hasExplored ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
          {ACTIVITY_CHIPS.map((chip) => {
            const isActive = chip.id === activeCategory;

            return (
              <Pressable
                key={chip.id}
                onPress={() => setActiveCategory(chip.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                style={({ pressed }) => [
                  {
                    paddingHorizontal: theme.space.lg,
                    paddingVertical: theme.space.sm,
                    borderRadius: theme.radius.pill,
                    borderWidth: 1,
                    borderColor: isActive ? theme.color.primary : theme.color.border,
                    backgroundColor: isActive ? theme.color.primary : theme.color.surface,
                  },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  variant="xs"
                  weight="semibold"
                  tone={isActive ? 'light' : 'muted'}
                  leading="tight"
                >
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {activitiesError ? <Problem message={activitiesError} /> : null}

      {isLoadingActivities ? (
        <Card>
          <View style={{ alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.lg }}>
            <ActivityIndicator color={theme.color.primary} />
            <Text variant="sm" tone="muted" leading="snug">
              Loading activities in {exploredCity ?? typedCity}…
            </Text>
          </View>
        </Card>
      ) : !hasExplored ? (
        <Empty
          title={emptyTitle(selection.countryName, typedCity)}
          description={emptyDescription(
            selection.countryName,
            typedCity,
            cities.length,
            isLoadingCities,
          )}
        />
      ) : visible.length === 0 ? (
        <Empty
          title={
            activities.length === 0
              ? `We found nothing to do in ${exploredCity}`
              : 'Nothing in this category yet'
          }
          description={
            activities.length === 0
              ? 'Try a larger city nearby, or a different one in this country.'
              : 'Pick another category to see what else is on offer here.'
          }
        />
      ) : (
        <Text variant="xs" tone="muted" accessibilityRole="text">
          {visible.length} {visible.length === 1 ? 'activity' : 'activities'}
        </Text>
      )}
    </View>
  );

  return (
    <Screen scroll={false}>
      <FlatList
        data={isLoadingActivities ? [] : visible}
        keyExtractor={(activity) => activity.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.space.md, paddingBottom: theme.space.xl }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <ActivityCard activity={item} categoryLabel={categoryLabel(item.category)} />
        )}
        /*
         * The web pulls the next page from a sentinel below the grid, so a
         * filtered view that has matched nothing keeps fetching until it does.
         * `onEndReached` is the same idea with the observer already written.
         */
        onEndReached={() => {
          if (hasMore && !isLoadingActivities && !isLoadingMore) loadMore();
        }}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          !hasExplored || isLoadingActivities ? null : hasMore ? (
            <View style={{ paddingTop: theme.space.md }}>
              <Button
                variant="secondary"
                fullWidth
                loading={isLoadingMore}
                onPress={() => loadMore()}
              >
                Load more activities
              </Button>
            </View>
          ) : activities.length > 0 ? (
            <Text
              variant="xs"
              tone="muted"
              leading="snug"
              style={{ textAlign: 'center', paddingTop: theme.space.md }}
            >
              That is everything we found here.
            </Text>
          ) : null
        }
      />

      {isPickingCountry ? (
        <CountryPicker
          countries={countries}
          selectedCode={selection.countryCode}
          onSelect={(country) => {
            selectCountry(country);
            setIsPickingCountry(false);
          }}
          onClose={() => setIsPickingCountry(false)}
        />
      ) : null}
    </Screen>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <Text variant="sm" tone="danger" leading="snug" accessibilityRole="alert">
      {message}
    </Text>
  );
}

function Empty({ title, description }: { title: string; description: string }) {
  const theme = useTheme();

  return (
    <Card>
      <View style={{ alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.lg }}>
        <CompassIcon size={26} color={theme.color.textMuted} />
        <Text variant="sm" weight="semibold" leading="tight" style={{ textAlign: 'center' }}>
          {title}
        </Text>
        <Text variant="xs" tone="muted" leading="snug" style={{ textAlign: 'center' }}>
          {description}
        </Text>
      </View>
    </Card>
  );
}

function cityPlaceholder(
  countryName: string | null,
  cityCount: number,
  isLoadingCities: boolean,
): string {
  if (!countryName) return 'Choose a country first';
  if (isLoadingCities) return 'Loading cities…';
  if (cityCount === 0) return 'No cities listed — type one';

  return `Search ${cityCount.toLocaleString()} cities`;
}

/** The prompt walks the reader through whichever step they have not done. */
function emptyTitle(countryName: string | null, city: string | null): string {
  if (!countryName) return 'Choose a destination to explore activities';
  if (!city) return `Choose a city in ${countryName}`;

  return `Ready to explore ${city}`;
}

function emptyDescription(
  countryName: string | null,
  city: string | null,
  cityCount: number,
  isLoadingCities: boolean,
): string {
  if (!countryName) return 'Pick a country above, then a city in it.';
  if (isLoadingCities) return `Loading the cities of ${countryName}…`;
  if (cityCount === 0) {
    return `We have no city list for ${countryName}. Type a city name and we will still look it up.`;
  }
  if (!city) return `Search ${cityCount.toLocaleString()} cities, then press Explore.`;

  return 'Press Explore to see what is there.';
}
