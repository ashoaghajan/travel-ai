import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FormEvent } from 'react';
import { ROUTES } from '../../../app/routes';
import { Button } from '../../../components/common/Button';
import { Logo } from '../../../components/common/Logo';
import { ArrowLeftIcon, SparklesIcon } from '../../../components/common/icons';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { guestDraftService } from '../../../services/guestDraft.service';
import { plannerService } from '../../../services/planner.service';
import { settingsService } from '../../../services/settings.service';
import { tripStore } from '../../../store/trip.store';
import { bookingStore } from '../../../store/booking.store';
import type { TripDraft } from '../../../types/trip.types';
import { ItineraryPreview } from '../components/ItineraryPreview';
import styles from './GuestPlannerPage.module.css';

const EXAMPLES = [
  'A relaxed 5-day food and culture trip to Lisbon in May for two',
  'A 7-day Bali trip for a couple who love beaches, nature and good food',
  'A long weekend in Paris with museums, cafes and easy walks',
];

export function GuestPlannerPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useCurrentUser();
  const [prompt, setPrompt] = useState('');
  const [trip, setTrip] = useState<TripDraft | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function plan(event?: FormEvent) {
    event?.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);
    setTrip(null);

    try {
      const result = await plannerService.generateItinerary(
        prompt.trim(),
        settingsService.getSettings().travel,
      );
      if (!result.trip) {
        setError(result.reply || 'Try describing a destination and how long you want to travel.');
        return;
      }
      setTrip(result.trip);
    } catch {
      setError('We could not make that itinerary just now. Please try another prompt.');
    } finally {
      setIsGenerating(false);
    }
  }

  async function saveForLater() {
    if (!trip) return;
    if (isAuthenticated) {
      try {
        const saved = await tripStore.saveTrip(trip);
        try { await bookingStore.createFromItinerary(saved); } catch { /* best effort */ }
        navigate(`/trips/${saved.id}`);
      } catch {
        setError('We could not save this itinerary. Please try again.');
      }
      return;
    }

    try {
      guestDraftService.save(trip);
      navigate(`${ROUTES.register}?next=${encodeURIComponent(ROUTES.claimGuestTrip)}`);
    } catch {
      setError('We could not keep this itinerary on this device. Please try again.');
    }
  }

  function chooseExample(example: string) {
    setPrompt(example);
    setTrip(null);
    setError(null);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link to={ROUTES.landing} className={styles.brand} aria-label="AI Travel, home">
          <Logo variant="dark" size="md" />
        </Link>
        <Link className={styles.back} to={ROUTES.landing}>
          <ArrowLeftIcon size={16} /> Back
        </Link>
      </header>

      <div className={styles.content}>
        <section className={styles.intro}>
          <span className={styles.eyebrow}><SparklesIcon size={16} /> YOUR TRIP STARTS HERE</span>
          <h1>Where would you like to go?</h1>
          <p>Tell us the destination, dates or trip length, who’s going, and what you enjoy. No account needed to preview a plan.</p>
        </section>

        <form className={styles.form} onSubmit={(event) => void plan(event)}>
          <label className="visually-hidden" htmlFor="guest-trip-prompt">Describe your trip</label>
          <textarea
            id="guest-trip-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="For example: 5 days in Lisbon this May, with great food and relaxed sightseeing…"
            rows={4}
            disabled={isGenerating}
          />
          <div className={styles.formFooter}>
            <span>More detail helps personalize your itinerary.</span>
            <Button type="submit" variant="primary" size="md" disabled={!prompt.trim() || isGenerating}>
              {isGenerating ? 'Planning…' : 'Create my itinerary'}
            </Button>
          </div>
        </form>

        {!trip && !isGenerating ? (
          <div className={styles.examples} aria-label="Try an example prompt">
            <span>Need inspiration?</span>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => chooseExample(example)}>
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {isGenerating ? <p className={styles.status} role="status">Building your itinerary…</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {trip ? (
          <section className={styles.result} aria-label="Your itinerary preview">
            <div className={styles.resultIntro}>
              <span className={styles.eyebrow}>YOUR FIRST DRAFT</span>
              <h2>Here’s a starting point for your trip.</h2>
              <p>Preview your days, then create a free account to save and customize the itinerary.</p>
            </div>
            <ItineraryPreview
              trip={trip}
              onSave={() => void saveForLater()}
              onCustomise={() => void saveForLater()}
            />
            {!isAuthenticated ? (
              <p className={styles.signIn}>Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    try {
                      guestDraftService.save(trip);
                      navigate(`${ROUTES.login}?next=${encodeURIComponent(ROUTES.claimGuestTrip)}`);
                    } catch {
                      setError('We could not keep this itinerary on this device. Please try again.');
                    }
                  }}
                >Sign in to save it</button>
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
