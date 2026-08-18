import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import type { Activity } from '../../core/types/travel.types';
import { CATEGORY_IMAGES } from '../../core/assets/category-images';
import { usdFormatter } from '../../core/utils/currency';
import { imageSource } from '../../assets/bundled-images';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

/**
 * One attraction (DESIGN_SPEC Screen 6): photo, title, description, rating.
 *
 * The web's `ActivityCard` minus the parts that only exist there. There is no
 * `to` — the phone has no attraction page yet — and no "Add to trip" or
 * "Book", which the web only renders on its booking screen.
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
}: {
  activity: Activity;
  categoryLabel?: string;
}) {
  const theme = useTheme();
  const { title, description, price, rating, reviews, image, category, imageCredit } = activity;

  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    setHasFailed(false);
  }, [image]);

  const source = imageSource(hasFailed ? CATEGORY_IMAGES[category] : image);
  const credit = hasFailed ? undefined : imageCredit;

  return (
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
            {usdFormatter.format(price)}{' '}
            <Text variant="xs" tone="muted" weight="regular">
              per person
            </Text>
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
