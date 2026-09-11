import type { StayCandidate } from '../../../types/planner.types';
import styles from './StayPicker.module.css';

export type StayPickerProps = {
  candidates: StayCandidate[];
  /** Null for "none of these", which moves the conversation on to the address. */
  onChoose: (candidateId: string | null) => void;
  /** True while a turn is in flight, so one list cannot be answered twice. */
  isBusy: boolean;
};

/**
 * The hotels the lookup found, for somebody to point at.
 *
 * Rendered under the question that asked, and it is shown even when there is
 * only one match. That is the point rather than an oversight: the planner is
 * about to draw a radius around this building and exclude everything outside
 * it, and a single confident-looking match is exactly the case where a wrong
 * one goes unnoticed — a city's worth of places disappears from the trip with
 * nothing on screen to say why.
 *
 * The address carries the whole burden of telling two rows apart, which is why
 * it sits inside the button rather than beside it, and why a row with no
 * address still shows its name alone rather than a placeholder.
 */
export function StayPicker({ candidates, onChoose, isBusy }: StayPickerProps) {
  return (
    <div className={styles.picker}>
      <ul className={styles.list}>
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              className={styles.option}
              disabled={isBusy}
              onClick={() => onChoose(candidate.id)}
            >
              <span className={styles.name}>{candidate.name}</span>
              {candidate.address ? (
                <span className={styles.address}>{candidate.address}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={styles.reject}
        disabled={isBusy}
        onClick={() => onChoose(null)}
      >
        None of these — I’ll give the address
      </button>
    </div>
  );
}
