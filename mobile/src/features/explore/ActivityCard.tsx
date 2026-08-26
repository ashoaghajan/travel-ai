import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import type { Activity } from '../../core/types/travel.types';
import { CATEGORY_IMAGES } from '../../core/assets/category-images';
import { useMoney } from '../../core/store/currency.store';
import { imageSource } from '../../assets/bundled-images';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * One attraction (DESIGN_SPEC Screen 6): photo, title, description, rating.
 *
 * The web's `ActivityCard` minus the parts that only exist there: no "Book",
 * which the web only renders on its booking screen.
 *
 * **`onPress` stands in for the web's `to`.** There, the card is a link to an
 * attraction page and the "Add to trip" button lives on that page. There is no
 * attraction page here, so the card opens `AddToTripSheet` directly — one tap
 * instead of two, and the page the reader would only have passed through is
 * not invented to hold a button.
 *
 * The card is only pressable when a handler is given. A card with no `onPress`
 * renders as it always did rather than as something that looks tappable and
 * is not, which is the bug this replaces: nothing happened because nothing was
 * ever wired, and the card gave no sign of it either way.
 *
 * **Two callers, two different acts, and the difference is not cosmetic.**
 * From the explorer the whole card is pressable and it files an *itinerary
 * activity* — a plan for a day, which is a guess. From the booking screen it
 * grows buttons and files a *booking* — a record of something arranged, which
 * is a fact. The web draws the same line by giving its card `to` for the first
 * and `onAddToTrip`/`bookingUrl` for the second; the props here are named after
 * the web's for that reason.
 *
 * **The photo falls back the same way, for the same reason.** Photographs come
 * from Wikimedia, so a URL can rot between the cache being written and the card
 * being drawn; without the fallback the reader gets a grey box in the middle of
 * the list. `onError` is RN's own, and the credit goes with the photo it
 * belongs to.
 */
export function ActivityCard({
  activity,
  categoryLabel,
  onPress,
  onAddToTrip,
  isOnTrip,
  bookingUrl,
}: {
  activity: Activity;
  categoryLabel?: string;
  /** Explorer: the whole card opens the itinerary sheet. */
  onPress?: () => void;
  /** Booking screen: record this as a booking rather than as a day's plan. */
  onAddToTrip?: () => void;
  /** Already recorded, so the button says so rather than inviting a duplicate. */
  isOnTrip?: boolean;
  /** Where the partner sells it. Absent when we have no link to offer. */
  bookingUrl?: string | null;
}) {
  const theme = useTheme();
  const money = useMoney();
  const { title, description, price, rating, reviews, image, category, imageCredit } = activity;

  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [image]);

  const source = imageSource(hasFailed ? CATEGORY_IMAGES[category] : image);
  const credit = hasFailed ? undefined : imageCredit;

  const card = (
    <Card padding="none" elevation="card" style={{ overflow: 'hidden' }}>
      <View>
        {source ? (
          <Image
            source={source}
            style={{ width: '100%', height: 170 }}
            resizeMode="cover"
            onError={() => setHasFailed(true)}
          />
        ) : (
          <View style={{ width: '100%', height: 170, backgroundColor: theme.color.primarySoft }} />
        )}

        {categoryLabel ? (
          <View
            style={{
              position: 'absolute',
              top: theme.space.md,
              left: theme.space.md,
              paddingHorizontal: theme.space.md,
              paddingVertical: theme.space.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.overlayTop,
            }}
          >
            <Text variant="xs" weight="semibold" tone="light" leading="tight">
              {categoryLabel}
            </Text>
          </View>
        ) : null}

        {/*
          Attribution, not a link. Wikimedia's licences require the credit to
          be shown, which this does; the web makes it clickable because a
          browser is already a browser. Opening one here would drop the reader
          out of the app mid-scroll, so the name and licence are stated and the
          `sourceUrl` waits for an attraction screen to put it on.
        */}
        {credit ? (
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              paddingHorizontal: theme.space.sm,
              paddingVertical: 2,
              backgroundColor: theme.color.overlayTop,
              borderTopLeftRadius: theme.radius.sm,
            }}
          >
            <Text variant="xs" tone="light" leading="tight" numberOfLines={1}>
              {[credit.author, credit.license].filter(Boolean).join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: theme.space.lg, gap: theme.space.xs }}>
        <Text variant="md" weight="semibold" leading="tight">
          {title}
        </Text>

        {/* Three lines: enough to say what a place is, short enough that the
            list stays scannable. */}
        <Text variant="sm" tone="muted" leading="snug" numberOfLines={3}>
          {description}
        </Text>

        {rating > 0 ? (
          <Text variant="xs" tone="muted" leading="tight">
            ★ <Text variant="xs" weight="semibold">{rating.toFixed(1)}</Text>
            {reviews > 0 ? ` (${reviews})` : ''}
          </Text>
        ) : null}

        {price > 0 ? (
          <Text variant="sm" weight="semibold" tone="primary" leading="tight">
            {money.format(price)}{' '}
            <Text variant="xs" tone="muted" weight="regular">
              per person
            </Text>
          </Text>
        ) : null}

        {/* Adding records it and stays here; booking leaves for the partner.
            Same order, and same reason, as the flight and hotel cards. The
            row is its own view because the card body is gapped for text. */}
        {onAddToTrip || bookingUrl ? (
          <View style={{ gap: theme.space.sm, marginTop: theme.space.sm }}>
            {onAddToTrip ? (
              <Button fullWidth onPress={onAddToTrip} disabled={isOnTrip}>
                {isOnTrip ? 'On this trip' : 'Add to trip'}
              </Button>
            ) : null}

            {bookingUrl ? (
              <Button
                variant="secondary"
                fullWidth
                onPress={() => void Linking.openURL(bookingUrl)}
              >
                Book
              </Button>
            ) : null}
          </View>
        ) : null}
      </View>
    </Card>
  );

  if (!onPress) return card;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Named rather than left to the card's own text, which reads out as a
      // photo credit and a price before it reaches what the button does.
      accessibilityLabel={`${activity.title}. Add to a trip.`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {card}
    </Pressable>
  );
}
