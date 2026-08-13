import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import type { TripDraft } from '../../../types/trip.types';
import { PageHeader } from '../../../components/layout/PageHeader';
import { IconButton } from '../../../components/common/IconButton';
import { Logo } from '../../../components/common/Logo';
import { BookmarkIcon, DownloadIcon, TrashIcon } from '../../../components/common/icons';
import { ChatMessage } from '../components/ChatMessage';
import { ItineraryPreview } from '../components/ItineraryPreview';
import { PlannerInput } from '../components/PlannerInput';
import { TypingIndicator } from '../components/TypingIndicator';
import { usePlanner } from '../usePlanner';
import { useTripExport } from '../../trips/useTripExport';
import styles from './PlannerPage.module.css';

/** `/trips/:tripId` for one saved trip. */
function tripPath(tripId: string): string {
  return ROUTES.tripDetails.replace(':tripId', encodeURIComponent(tripId));
}

/**
 * Screen 2 — AI Planner Dashboard (DESIGN_SPEC §8).
 *
 * A prompt goes to `plannerService`, which returns a mock itinerary; saving
 * persists it through `tripService` into localStorage.
 */
export function PlannerPage() {
  const {
    messages,
    error,
    savingMessageId,
    isGenerating,
    stop,
    savedTripIdFor,
    generate,
    saveTrip,
    customiseTrip,
    clearConversation,
  } = usePlanner();
  const navigate = useNavigate();
  const { exportTrip, error: exportError } = useTripExport();
  const pageEndRef = useRef<HTMLDivElement>(null);

  /**
   * Take a suggestion into the trip screen, where it can be edited.
   *
   * Saving first is what makes that possible — there is no editing surface for
   * an unsaved draft. On failure `usePlanner` has already set `error`, which
   * the page renders, so stay put rather than navigating into nothing.
   */
  async function customise(messageId: string, draft: TripDraft) {
    const trip = await customiseTrip(messageId, draft);
    if (!trip) return;

    navigate(tripPath(trip.id));
  }

  /**
   * Keep the newest turn in view as the conversation grows — including the
   * "thinking" indicator, which is the whole point of scrolling the moment a
   * turn starts rather than only when its words arrive.
   *
   * **The anchor sits after the composer, not after the conversation**, which
   * looks wrong and is the only thing that works. The composer is
   * `position: sticky; bottom: 0`, so while there is anything left to scroll it
   * is painted over the bottom of the scrollport. An anchor at the end of the
   * conversation is therefore aligned to a strip of viewport the composer is
   * covering, and the indicator directly above it stays hidden — which read as
   * the page simply not scrolling. Anchoring past the composer scrolls to the
   * true bottom, where the composer drops to its natural place at the end of
   * the flow and stops covering anything.
   *
   * This is why the fix is not a `scroll-margin`: the composer's height is not
   * a constant. It grows by a line for an error and by several for the speech
   * debug log.
   */
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pageEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages, isGenerating]);

  // The header bookmark saves the most recent itinerary, and the export button
  // writes that same one to a file — which works before it is saved, because
  // nothing in the file comes from the database row.
  const latestTripMessage = [...messages].reverse().find((message) => message.trip);
  const latestTripSaved = Boolean(savedTripIdFor(latestTripMessage?.trip));

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Travel Planner"
        leading={<Logo variant="dark" size="md" markOnly className={styles.mobileBrand} />}
        actions={
          <>
            {/*
              Every label here is also the hover tooltip — `IconButton` sets
              `title` from it — so each one says what the icon does and to
              what. "Clear conversation" in particular: it empties this chat
              and touches no saved trip, which is not what a bin next to an
              itinerary looks like it means.
            */}
            <IconButton
              label="Clear this conversation"
              disabled={isGenerating}
              onClick={clearConversation}
            >
              <TrashIcon size={20} />
            </IconButton>
            <IconButton
              label={
                latestTripMessage
                  ? 'Export this trip as a file'
                  : 'Nothing to export yet — ask for an itinerary first'
              }
              disabled={!latestTripMessage}
              onClick={() => {
                if (latestTripMessage?.trip) exportTrip(latestTripMessage.trip);
              }}
            >
              <DownloadIcon size={20} />
            </IconButton>
            <IconButton
              label={latestTripSaved ? 'Trip saved' : 'Save this trip'}
              disabled={!latestTripMessage || latestTripSaved || savingMessageId !== null}
              onClick={() => {
                if (latestTripMessage?.trip) {
                  void saveTrip(latestTripMessage.id, latestTripMessage.trip);
                }
              }}
            >
              <BookmarkIcon size={20} />
            </IconButton>
          </>
        }
      />

      <div className={styles.conversation}>
        <h2 className="visually-hidden">Conversation</h2>

        {messages.map((message) => (
          <ChatMessage key={message.id} author={message.author} content={message.content}>
            {message.trip ? (
              <ItineraryPreview
                trip={message.trip}
                savedTripId={savedTripIdFor(message.trip)}
                isSaving={savingMessageId === message.id}
                onSave={() => {
                  if (message.trip) void saveTrip(message.id, message.trip);
                }}
                onCustomise={() => {
                  if (message.trip) void customise(message.id, message.trip);
                }}
              />
            ) : null}
          </ChatMessage>
        ))}

        {isGenerating ? <TypingIndicator /> : null}
      </div>

      <div className={styles.composer}>
        <div className={styles.composerInner}>
          {error || exportError ? (
            <p className={styles.error} role="alert">
              {error ?? exportError}
            </p>
          ) : null}
          <PlannerInput
            isGenerating={isGenerating}
            onSend={(prompt) => void generate(prompt)}
            onStop={stop}
          />
        </div>
      </div>

      {/* Past the composer on purpose — see the scrolling effect above. */}
      <div ref={pageEndRef} aria-hidden="true" />
    </div>
  );
}
