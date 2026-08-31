import { Pressable, View } from 'react-native';
import {
  EMPTY_HOTEL_FILTERS,
  HOTEL_SORTS,
  countActiveFilters,
  priceBounds,
  priceHandle,
  ratingFilterOptions,
} from '@ai-travel/shared';
import type { HotelFilters, HotelSortId } from '@ai-travel/shared';
import type { Hotel } from '../../core/types/travel.types';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { PriceRangeSlider } from './PriceRangeSlider';

/**
 * How the Hotels tab is ordered and narrowed, on the phone.
 *
 * The rules are the web's, imported rather than reimplemented: `HOTEL_SORTS`,
 * `priceBounds` and the rest all come from `@ai-travel/shared`, so a range set
 * to $150–$250 hides the same stays here as it does in the browser. Only the
 * controls are native.
 *
 * Chips where the web uses a `<select>`, because a select becomes a system
 * picker wheel on a phone — two taps and a covered screen to change a sort —
 * where a row of chips shows every option and the chosen one at a glance, and
 * is the idiom the Explore screen already uses for its categories. The price
 * range is the exception: it is a slider on both, in `PriceRangeSlider`.
 */

/** One chip. Shared by the sort row and both filter rows below it. */
function Chip({
  label,
  isActive,
  onPress,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
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
      <Text variant="xs" weight="semibold" tone={isActive ? 'light' : 'muted'} leading="tight">
        {label}
      </Text>
    </Pressable>
  );
}

/** A labelled row of chips, or nothing at all when there are none to show. */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.xs }}>
      <Text variant="xs" tone="muted" leading="tight">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
        {children}
      </View>
    </View>
  );
}

export function HotelFilterBar({
  hotels,
  sort,
  onSortChange,
  filters,
  onFiltersChange,
}: {
  /**
   * The whole result, not what is currently visible.
   *
   * The options are drawn from it, and options that narrowed as the reader
   * filtered would leave no way back up.
   */
  hotels: Hotel[];
  sort: HotelSortId;
  onSortChange: (sort: HotelSortId) => void;
  filters: HotelFilters;
  onFiltersChange: (filters: HotelFilters) => void;
}) {
  const theme = useTheme();

  const bounds = priceBounds(hotels);
  const ratingOptions = ratingFilterOptions(hotels);
  const activeCount = countActiveFilters(filters);

  return (
    <View style={{ gap: theme.space.md }}>
      <ChipRow label="Sort by">
        {HOTEL_SORTS.map((option) => (
          <Chip
            key={option.id}
            label={option.short}
            isActive={option.id === sort}
            onPress={() => onSortChange(option.id)}
          />
        ))}
      </ChipRow>

      {/*
        Omitted rather than shown inert when the results cannot be ranged over,
        which is every unpriced `listing` result. A slider whose two ends are
        the same figure is a control that was never going to do anything.
      */}
      {bounds ? (
        <PriceRangeSlider
          bounds={bounds}
          // A handle that has never been moved rests on the end of the range,
          // which is where "no filter" is drawn.
          min={filters.minPrice ?? bounds.min}
          max={filters.maxPrice ?? bounds.max}
          onChange={(next) =>
            onFiltersChange({
              ...filters,
              minPrice: priceHandle(next.min, bounds.min),
              maxPrice: priceHandle(next.max, bounds.max),
            })
          }
        />
      ) : null}

      {ratingOptions.length > 0 ? (
        <ChipRow label="Minimum rating">
          {ratingOptions.map((rating) => (
            <Chip
              key={rating}
              label={`${rating.toFixed(1)}+`}
              isActive={filters.minRating === rating}
              onPress={() =>
                onFiltersChange({
                  ...filters,
                  minRating: filters.minRating === rating ? null : rating,
                })
              }
            />
          ))}
        </ChipRow>
      ) : null}

      {activeCount > 0 ? (
        <View style={{ flexDirection: 'row' }}>
          <Chip
            label={`Clear ${activeCount === 1 ? 'filter' : 'filters'}`}
            isActive={false}
            onPress={() => onFiltersChange(EMPTY_HOTEL_FILTERS)}
          />
        </View>
      ) : null}
    </View>
  );
}
