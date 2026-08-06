import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { Skeleton } from '../../../components/common/Skeleton';
import { LazyRouteMap } from '../../../components/map/LazyRouteMap';
import { BackLink } from '../../trips/components/BackLink';
import {
  BookmarkIcon,
  CompassIcon,
  ExternalLinkIcon,
  MapIcon,
  MapPinIcon,
  PlusIcon,
  StarIcon,
} from '../../../components/common/icons';
import { CATEGORY_IMAGES } from '../../../assets/category-images';
import { ROUTES } from '../../../app/routes';
import type { ActivityDetails } from '../../../services/activity.service';
import { savedActivityStore, useIsActivitySaved } from '../../../store/savedActivity.store';
import { categoryLabel } from '../activity.filters';
import { useActivityDetails } from '../useActivityDetails';
import { AddToTripDialog } from '../components/AddToTripDialog';
import { exploreService } from '../../../services/explore.service';
import styles from './ActivityDetailsPage.module.css';

/**
 * Which country this place is actually in.
 *
 * The attraction's own address is the answer whenever the provider gives one:
 * it is a fact about the place, so it holds however the reader arrived — a
 * shared link, a reload, a browsing selection that has since moved on. The
 * `/xid` lookup this page already makes returns it.
 *
 * The country the reader was browsing is the fallback, for the places
 * OpenTripMap has no address for. Null when neither is known, which allows
 * every trip: a mismatch that cannot be shown is not one worth blocking on.
 */
function placeCountryOf(activity: ActivityDetails): string | null {
  return activity.country ?? exploreService.getChosenSelection().country?.name ?? null;
}

/** Screen 6a — one attraction, with the actions that make it useful. */
export function ActivityDetailsPage() {
  const { activityId } = useParams<{ activityId: string }>();
  const { activity, isLoading, error, notFound, retry } = useActivityDetails(activityId);

  const isSaved = useIsActivitySaved(activity?.id);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [activity?.image]);

  // The confirmation is an aside, not a state to sit in.
  useEffect(() => {
    if (!confirmation) return;

    const timer = window.setTimeout(() => setConfirmation(null), 6000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  if (isLoading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Attraction" />
        <div className={styles.content} aria-busy="true">
          <span className="visually-hidden">Loading this attraction…</span>
          <Skeleton height="260px" radius="lg" />
          <Skeleton width="60%" height="28px" />
          <Skeleton width="40%" height="16px" />
          <Skeleton height="72px" radius="md" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.page}>
        <PageHeader title="Attraction" />
        <div className={styles.content}>
          <BackLink to={ROUTES.activities} label="Back to Explore" />
          <EmptyState
            icon={<CompassIcon size={26} />}
            title="We could not load this attraction"
            description={error}
            action={
              <Button variant="primary" onClick={retry}>
                Try again
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  if (notFound || !activity) {
    return (
      <div className={styles.page}>
        <PageHeader title="Attraction" />
        <div className={styles.content}>
          <BackLink to={ROUTES.activities} label="Back to Explore" />
          <EmptyState
            icon={<CompassIcon size={26} />}
            title="We could not find this attraction"
            description="The link may be out of date, or the place may no longer be listed."
            action={
              <Button to={ROUTES.activities} variant="primary">
                Explore activities
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const image = imageFailed ? CATEGORY_IMAGES[activity.category] : activity.image;
  const credit = imageFailed ? undefined : activity.imageCredit;

  async function toggleSaved() {
    if (!activity) return;

    const nowSaved = await savedActivityStore.toggle(activity);
    setConfirmation(nowSaved ? 'Saved for later.' : 'Removed from your saved list.');
  }

  return (
    <div className={styles.page}>
      <PageHeader title={activity.title} subtitle={categoryLabel(activity.category)} />

      <div className={styles.content}>
        <BackLink to={ROUTES.activities} label="Back to Explore" />

        <Card padding="none" elevation="card" className={styles.hero}>
          <div className={styles.media}>
            <img
              className={styles.image}
              src={image}
              alt=""
              decoding="async"
              onError={() => setImageFailed(true)}
            />
            <span className={styles.categoryBadge}>{categoryLabel(activity.category)}</span>
            {credit ? (
              <a
                className={styles.credit}
                href={credit.sourceUrl}
                target="_blank"
                rel="noreferrer nofollow"
                title={`Photo by ${credit.author ?? 'unknown'} — ${credit.license ?? 'see source'}`}
              >
                {[credit.author, credit.license].filter(Boolean).join(' · ')}
              </a>
            ) : null}
          </div>

          <div className={styles.heroBody}>
            <h2 className={styles.title}>{activity.title}</h2>
            <p className={styles.summary}>{activity.description}</p>

            <div className={styles.meta}>
              {activity.rating > 0 ? (
                <span className={styles.metaItem}>
                  <StarIcon size={14} className={styles.star} />
                  {activity.rating.toFixed(1)}
                </span>
              ) : null}
              {activity.address ? (
                <span className={styles.metaItem}>
                  <MapPinIcon size={14} />
                  {activity.address}
                </span>
              ) : null}
            </div>
          </div>
        </Card>

        <div className={styles.actions}>
          <Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={() => setIsAddOpen(true)}>
            Add To Trip
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<BookmarkIcon size={16} />}
            onClick={toggleSaved}
            aria-pressed={isSaved}
          >
            {isSaved ? 'Saved For Later' : 'Save For Later'}
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<MapIcon size={16} />}
            onClick={() => setShowMap((shown) => !shown)}
            aria-expanded={showMap}
            disabled={!activity.coordinates}
          >
            Show On Map
          </Button>
        </div>

        {confirmation ? (
          <p className={styles.confirmation} role="status">
            {confirmation}
          </p>
        ) : null}

        {!activity.coordinates ? (
          <p className={styles.note}>This place has no coordinates, so it cannot be mapped.</p>
        ) : null}

        {showMap && activity.coordinates ? (
          <Card padding="lg" elevation="soft" className={styles.mapCard}>
            <h3 className={styles.sectionTitle}>Where it is</h3>
            {/* One place, so no route line and no fitting a spread — the map
                centres on the pin. Coordinates come straight from OpenTripMap,
                which is why this page never needs geocoding. */}
            <LazyRouteMap
              points={[
                { id: activity.id, label: activity.title, coordinates: activity.coordinates },
              ]}
              showRoute={false}
              size="lg"
              scrollWheelZoom
              ariaLabel={`Map showing ${activity.title}`}
            />
          </Card>
        ) : null}

        {activity.fullDescription ? (
          <Card padding="lg" elevation="soft">
            <h3 className={styles.sectionTitle}>About</h3>
            <p className={styles.prose}>{activity.fullDescription}</p>
          </Card>
        ) : null}

        {activity.sourceUrl ? (
          <a
            className={styles.source}
            href={activity.sourceUrl}
            target="_blank"
            rel="noreferrer nofollow"
          >
            View on OpenTripMap
            <ExternalLinkIcon size={14} />
          </a>
        ) : null}
      </div>

      {isAddOpen ? (
        <AddToTripDialog
          activity={activity}
          placeCountry={placeCountryOf(activity)}
          onClose={() => setIsAddOpen(false)}
          onAdded={(tripTitle) => setConfirmation(`Added to ${tripTitle}.`)}
        />
      ) : null}
    </div>
  );
}
