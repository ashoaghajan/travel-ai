import { Link } from 'react-router-dom';
import { CrownIcon } from '../../../components/common/icons';
import styles from './PlannerTierNote.module.css';

/**
 * What the free planner is, said once, where the limit is felt.
 *
 * A line above the composer rather than a modal, a toast or a banner on every
 * bubble: it is a fact about the tool, and it belongs beside the tool. Somebody
 * who reads it once and upgrades never sees it again; somebody who is happy on
 * templates is not asked twice per prompt.
 *
 * **It describes rather than apologises.** The free planner builds real trips
 * from real templates — it was the whole product once — so the copy names what
 * each tier does instead of framing one as broken. Nothing here appears for a
 * Pro account; the caller renders it only for free.
 */
export function PlannerTierNote() {
  return (
    <p className={styles.note}>
      <CrownIcon size={14} className={styles.icon} />
      <span>
        <strong className={styles.strong}>Quick planner.</strong> Builds trips from templates, and
        answers weather and places. Pro writes them with Claude, and you can talk to it.
      </span>
      <Link to="/profile" className={styles.link}>
        Upgrade
      </Link>
    </p>
  );
}
