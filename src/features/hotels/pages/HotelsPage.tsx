import { useMemo, useState } from 'react';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { Button } from '../../../components/common/Button';
import { PriceNote } from '../../../components/common/PriceNote';
import { HotelCard } from '../../../components/cards/HotelCard';
import { MapView } from '../../../components/map/MapView';
import { MapPinIcon } from '../../../components/common/icons';
import { formatDateRange } from '../../../utils/date';
import { HotelToolbar } from '../components/HotelToolbar';
import { HotelFilterPanel } from '../components/HotelFilterPanel';
import {
  EMPTY_HOTEL_FILTERS,
  applyHotelFilters,
  countActiveFilters,
  sortHotels,
} from '../hotel.filters';
import type { HotelFilters, HotelSortId } from '../hotel.filters';
import { useHotelSearch } from '../useHotelSearch';
import styles from './HotelsPage.module.css';

const FILTER_PANEL_ID = 'hotel-filters';
const SKELETON_COUNT = 3;

/** Screen 5 — Hotel results with mock data (DESIGN_SPEC §8). */
export function HotelsPage() {
  const { hotels, query, source, quotedAt, error, isLoading } = useHotelSearch();

  const [sort, setSort] = useState<HotelSortId>('recommended');
  const [filters, setFilters] = useState<HotelFilters>(EMPTY_HOTEL_FILTERS);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);

  const visible = useMemo(
    () => sortHotels(applyHotelFilters(hotels, filters), sort),
    [hotels, filters, sort],
  );

  const activeFilterCount = countActiveFilters(filters);

  return (
    <div className={styles.page}>
      <PageHeader
        title={`Hotels in ${query.destination}`}
        subtitle={`${formatDateRange(query.checkIn, query.checkOut)}, ${query.guests} Guests`}
      />

      <div className={styles.content}>
        <HotelToolbar
          sort={sort}
          onSortChange={setSort}
          isFilterOpen={isFilterOpen}
          onToggleFilter={() => setIsFilterOpen((open) => !open)}
          isMapOpen={isMapOpen}
          onToggleMap={() => setIsMapOpen((open) => !open)}
          activeFilterCount={activeFilterCount}
          filterPanelId={FILTER_PANEL_ID}
        />

        {isLoading ? null : <PriceNote source={source} quotedAt={quotedAt} />}

        {isFilterOpen ? (
          <HotelFilterPanel id={FILTER_PANEL_ID} filters={filters} onChange={setFilters} />
        ) : null}

        {isMapOpen && visible.length > 0 ? (
          <MapView
            stops={visible.map((hotel) => ({ id: hotel.id, label: hotel.name }))}
            showRoute={false}
            caption="Map preview"
          />
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <div className={styles.list} aria-busy="true">
            <span className="visually-hidden">Loading stays…</span>
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <Card key={index} padding="none" elevation="soft" className={styles.skeletonCard}>
                <Skeleton height="150px" radius="sm" className={styles.skeletonMedia} />
                <div className={styles.skeletonBody}>
                  <Skeleton width="60%" height="18px" />
                  <Skeleton width="40%" height="12px" />
                  <Skeleton width="25%" height="20px" />
                </div>
              </Card>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<MapPinIcon size={26} />}
            title="No stays match these filters"
            description="Try a higher price cap or a lower rating to see more places in this area."
            action={
              <Button variant="primary" size="md" onClick={() => setFilters(EMPTY_HOTEL_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <p className={styles.count}>
              {visible.length} of {hotels.length} stays
            </p>
            <ul className={styles.list}>
              {visible.map((hotel) => (
                <HotelCard key={hotel.id} as="li" hotel={hotel} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
