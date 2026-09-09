import type { TravelPreferences } from '../../../types/planner.types';
import type { ActivityCategory } from '../../../types/trip.types';
import { Switch } from '../../../components/common/Switch';
import { SettingsSection } from './SettingsSection';
import styles from './PlanningSection.module.css';

/**
 * The preferences the itinerary scheduler plans against.
 *
 * Everything here is a constraint rather than a decoration: the hours bound
 * the timeline, the weights choose what goes in it, the budget stops it. That
 * is why this section exists at all — the planner used to fill in a template,
 * and a template has nothing to apply a preference to.
 *
 * **Structured input, not a sentence.** These could all be typed into the
 * planner chat, and none of them would survive the trip: "nothing before
 * eleven, keep it under forty" parses reliably in a demo and unreliably in
 * life. A form asks once and is right every time after.
 */

/**
 * The five somebody actually chooses between.
 *
 * `travel` is on the category union for transfers and departure days; no
 * attraction is ever one, so offering a slider for it would be offering a
 * control that changes nothing.
 */
const CHOOSABLE: { id: ActivityCategory; label: string; hint: string }[] = [
  { id: 'culture', label: 'Culture & history', hint: 'Museums, old towns, architecture' },
  { id: 'nature', label: 'Nature', hint: 'Parks, beaches, viewpoints' },
  { id: 'food', label: 'Food & drink', hint: 'Markets, restaurants, tastings' },
  { id: 'adventure', label: 'Adventure', hint: 'Diving, climbing, volcanoes' },
  { id: 'relaxation', label: 'Relaxation', hint: 'Spas, quiet corners, slow mornings' },
];

/**
 * Words for the five stops on the slider.
 *
 * "Never" is not a synonym for "less": zero excludes the category from the
 * trip outright, and somebody dragging a handle to the end deserves to be told
 * that is what they did.
 */
const WEIGHT_LABELS = ['Never', 'Rarely', 'Sometimes', 'Often', 'Whenever I can'];

function weightLabel(weight: number): string {
  return WEIGHT_LABELS[Math.round(weight * 4)] ?? WEIGHT_LABELS[2];
}

/**
 * The radii offered, in whole kilometres, plus "no limit" as the first stop.
 *
 * A ladder rather than a typed number, and that is a considered choice: the
 * server takes 1–100, so a typed box has a rejectable range, and a rejected
 * value here is a preference that silently reverts. A ladder cannot be wrong.
 *
 * The stops are the distances somebody would actually mean — a 20-minute walk,
 * a short ride, most of a city — rather than an even scale.
 */
const DISTANCE_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'No limit' },
  { value: 1, label: '1 km' },
  { value: 2, label: '2 km' },
  { value: 3, label: '3 km' },
  { value: 5, label: '5 km' },
  { value: 10, label: '10 km' },
];

const PACES: { id: TravelPreferences['pace']; label: string; hint: string }[] = [
  { id: 'relaxed', label: 'Relaxed', hint: 'Two things a day' },
  { id: 'balanced', label: 'Balanced', hint: 'Three things a day' },
  { id: 'packed', label: 'Packed', hint: 'Five things a day' },
];

export type PlanningSectionProps = {
  travel: TravelPreferences;
  onChange: (patch: Partial<TravelPreferences>) => void;
};

/**
 * An empty budget field means "no ceiling", which is what null is on the wire.
 *
 * Zero is a different answer and a valid one — it means free things only — so
 * the empty string cannot be coerced with `Number()`, which would turn "no
 * limit" into "nothing over $0" and quietly empty somebody's itinerary.
 */
function toBudget(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const parsed = Number.parseInt(trimmed, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function PlanningSection({ travel, onChange }: PlanningSectionProps) {
  return (
    <SettingsSection
      title="Planning"
      description="How a generated trip should be put together. These apply to every trip the planner builds for you."
    >
      <div className={styles.hours}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Days start at</span>
          <input
            type="time"
            className={styles.input}
            value={travel.dayStart}
            onChange={(event) => onChange({ dayStart: event.target.value })}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Nothing new after</span>
          <input
            type="time"
            className={styles.input}
            value={travel.dayEnd}
            onChange={(event) => onChange({ dayEnd: event.target.value })}
          />
        </label>
      </div>

      {/* Says the thing the two fields above cannot, and that a reader would
          otherwise discover from a 20:30 dinner they did not expect. */}
      <p className={styles.note}>
        Dinner is still planned for the evening — the second time is about when the day stops
        starting new things.
      </p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.fieldLabel}>Pace</legend>
        <div className={styles.segmented}>
          {PACES.map((option) => (
            <label
              key={option.id}
              className={styles.segment}
              data-checked={travel.pace === option.id}
            >
              <input
                type="radio"
                name="pace"
                className="visually-hidden"
                value={option.id}
                checked={travel.pace === option.id}
                onChange={() => onChange({ pace: option.id })}
              />
              <span className={styles.segmentLabel}>{option.label}</span>
              <span className={styles.segmentHint}>{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.fieldLabel}>What you like</legend>
        <div className={styles.weights}>
          {CHOOSABLE.map((category) => {
            const weight = travel.categoryWeights[category.id] ?? 0.5;

            return (
              <div key={category.id} className={styles.weight}>
                <label className={styles.weightHeader} htmlFor={`weight-${category.id}`}>
                  <span className={styles.weightLabel}>{category.label}</span>
                  <span className={styles.weightValue} data-off={weight === 0}>
                    {weightLabel(weight)}
                  </span>
                </label>
                <input
                  id={`weight-${category.id}`}
                  type="range"
                  className={styles.range}
                  min={0}
                  max={1}
                  step={0.25}
                  value={weight}
                  aria-describedby={`weight-hint-${category.id}`}
                  onChange={(event) =>
                    onChange({
                      categoryWeights: {
                        ...travel.categoryWeights,
                        [category.id]: Number(event.target.value),
                      },
                    })
                  }
                />
                <p id={`weight-hint-${category.id}`} className={styles.weightHint}>
                  {category.hint}
                </p>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className={styles.hours}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Most per activity</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={5}
            className={styles.input}
            placeholder="No limit"
            value={travel.maxActivityPrice ?? ''}
            onChange={(event) => onChange({ maxActivityPrice: toBudget(event.target.value) })}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Most per day</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={10}
            className={styles.input}
            placeholder="No limit"
            value={travel.dailyActivityBudget ?? ''}
            onChange={(event) => onChange({ dailyActivityBudget: toBudget(event.target.value) })}
          />
        </label>
      </div>

      {/*
        The honest sentence about what a budget can and cannot do here. Only a
        bookable product carries a real price; an attraction has none, and
        pretending otherwise would put a number on a museum that nobody quoted.
      */}
      <p className={styles.note}>
        In US dollars, per person. Places with no published price are never excluded by a budget —
        most attractions do not publish one.
      </p>

      <fieldset className={styles.fieldset}>
        <legend className={styles.fieldLabel}>Distance from your hotel</legend>
        <div className={styles.segmented}>
          {DISTANCE_OPTIONS.map((option) => (
            <label
              key={option.label}
              className={styles.segment}
              data-checked={travel.maxDistanceFromHotelKm === option.value}
            >
              <input
                type="radio"
                name="maxDistanceFromHotelKm"
                className="visually-hidden"
                value={option.value ?? ''}
                checked={travel.maxDistanceFromHotelKm === option.value}
                onChange={() => onChange({ maxDistanceFromHotelKm: option.value })}
              />
              <span className={styles.segmentLabel}>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/*
        Which point the radius is measured from, said out loud.
        
        The planner runs before anything is booked, so most of the time this is
        the middle of the city rather than a hotel — and "3 km from your hotel"
        and "3 km from the middle of Tbilisi" are different promises. A reader
        who is not told which one they got cannot make sense of what came back.
      */}
      <p className={styles.note}>
        Measured from your hotel when you have one booked and not yet attached to a trip, and from
        the middle of the destination when you do not. Straight-line distance.
      </p>

      <Switch
        label="Only near a metro station"
        description="Plan nothing more than a ten-minute walk from the metro. Ignored where there is no metro, rather than emptying the trip."
        checked={travel.nearMetroOnly}
        onChange={(checked) => onChange({ nearMetroOnly: checked })}
      />

      <Switch
        label="Plan a lunch"
        description="Hold the middle of the day open and find somewhere near it."
        checked={travel.meals.lunch}
        onChange={(checked) => onChange({ meals: { ...travel.meals, lunch: checked } })}
      />
      <Switch
        label="Plan a dinner"
        description="Finish the day somewhere to eat."
        checked={travel.meals.dinner}
        onChange={(checked) => onChange({ meals: { ...travel.meals, dinner: checked } })}
      />
    </SettingsSection>
  );
}
