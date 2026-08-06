import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '../../../components/common/icons';
import styles from './BackLink.module.css';

export type BackLinkProps = {
  to: string;
  label: string;
};

/** Icon-only back link used in the trip screens' headers. */
export function BackLink({ to, label }: BackLinkProps) {
  return (
    <Link to={to} className={styles.back} aria-label={label}>
      <ArrowLeftIcon size={20} />
    </Link>
  );
}
