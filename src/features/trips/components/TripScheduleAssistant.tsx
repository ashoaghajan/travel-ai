import { useState } from 'react';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import type { ItineraryActivity, ItineraryDay } from '../../../types/trip.types';
import { plannerService } from '../../../services/planner.service';
import { settingsService } from '../../../services/settings.service';
import styles from './TripScheduleAssistant.module.css';

export type TripScheduleAssistantProps = {
  title: string;
  destination: string;
  startDate: string;
  travellers: number;
  days: ItineraryDay[];
  onAddIdeas: (dayId: string, ideas: ItineraryActivity[]) => void;
};

/** Generate suggestions in the context of an open trip without replacing its schedule. */
export function TripScheduleAssistant({
  title,
  destination,
  startDate,
  travellers,
  days,
  onAddIdeas,
}: TripScheduleAssistantProps) {
  const [request, setRequest] = useState('');
  const [suggestions, setSuggestions] = useState<ItineraryDay[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedDays, setAddedDays] = useState<string[]>([]);

  async function generate() {
    const detail = request.trim();
    if (!detail || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    setSuggestions(null);
    setAddedDays([]);

    try {
      const result = await plannerService.generateItinerary(
        `Plan exactly ${Math.max(days.length, 1)} days in ${destination}, starting ${startDate}, for ${travellers} travellers. ${detail}`,
        settingsService.getSettings().travel,
      );
      if (!result.trip?.itinerary.length) {
        setError(result.reply || 'Try describing the kind of activities you want.');
      } else {
        setSuggestions(result.trip.itinerary);
      }
    } catch {
      setError('We could not create suggestions just now. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Card padding="lg" elevation="soft" className={styles.card}>
      <div className={styles.heading}>
        <div>
          <h2>Ask AI for ideas</h2>
          <p>Get suggestions for {title} and add only the ones you like. Your current schedule stays as it is.</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void generate(); }}>
        <label className="visually-hidden" htmlFor="trip-schedule-request">What would you like to add?</label>
        <input
          id="trip-schedule-request"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder="e.g. Add local food, a relaxed pace, and one nature activity each day"
          disabled={isGenerating}
        />
        <Button type="submit" variant="primary" disabled={!request.trim() || isGenerating}>
          {isGenerating ? 'Finding ideas…' : 'Suggest activities'}
        </Button>
      </form>

      {isGenerating ? <p className={styles.status} role="status">Creating ideas for your trip…</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {suggestions ? (
        <div className={styles.suggestions}>
          <h3>Suggestions for {destination}</h3>
          <p className={styles.disclosure}>Add ideas day by day. Nothing is saved until you press Save Changes.</p>
          {suggestions.map((suggestion, index) => {
            const targetDay = days[index];
            const ideas = suggestion.activities;
            const alreadyAdded = targetDay ? addedDays.includes(targetDay.id) : false;
            return (
              <section className={styles.day} key={`${suggestion.id}-${index}`}>
                <div className={styles.dayHeading}>
                  <h4>Day {index + 1}{targetDay ? ` · ${targetDay.destination}` : ''}</h4>
                  {targetDay ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      disabled={ideas.length === 0 || alreadyAdded || isGenerating}
                      onClick={() => {
                        onAddIdeas(targetDay.id, ideas);
                        setAddedDays((current) => [...current, targetDay.id]);
                      }}
                    >
                      {alreadyAdded ? 'Added to trip' : `Add ${ideas.length} ${ideas.length === 1 ? 'idea' : 'ideas'}`}
                    </Button>
                  ) : null}
                </div>
                {ideas.length ? (
                  <ul>
                    {ideas.map((idea) => (
                      <li key={idea.id}><span>{idea.time}</span><strong>{idea.title}</strong><p>{idea.description}</p></li>
                    ))}
                  </ul>
                ) : <p className={styles.disclosure}>No activities suggested for this day.</p>}
              </section>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}
