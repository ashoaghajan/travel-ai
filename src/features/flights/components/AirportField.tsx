import { useEffect, useId, useRef, useState } from 'react';
import type { Airport } from '../../../types/travel.types';
import { airportService } from '../../../services/airport.service';
import { cx } from '../../../utils/cx';
import styles from './AirportField.module.css';

/** Long enough that typing "london" is one request, short enough to feel live. */
const DEBOUNCE_MS = 200;

export type AirportFieldProps = {
  label: string;
  /** The selected IATA code. */
  value: string;
  onChange: (code: string) => void;
  className?: string;
};

/**
 * Type-to-search airport picker.
 *
 * Replaces the eight-option `<select>` this field used to be. That list was
 * fine while the fares were invented; the provider prices any route, so the
 * picker has to offer more than eight airports.
 *
 * Built as an ARIA combobox rather than reached for from a library: the
 * behaviour that matters is a text input, a listbox, and arrow keys, and the
 * project has no combobox dependency to justify adding one for this.
 */
export function AirportField({ label, value, onChange, className }: AirportFieldProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Airport[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<Airport | undefined>(() =>
    airportService.resolve(value),
  );

  const rootRef = useRef<HTMLDivElement>(null);

  // Keep the displayed airport in step when the caller changes the code — the
  // swap button does exactly that.
  useEffect(() => {
    const known = airportService.resolve(value);
    setSelected(known);
  }, [value]);

  // Search as they type. The abort matters: without it a slow early request
  // can land after a fast later one and overwrite the right answer.
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim();
    if (!trimmed) {
      setOptions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      airportService
        .search(trimmed, controller.signal)
        .then((found) => {
          setOptions(found);
          setActive(0);
        })
        .catch(() => {
          // Aborted, or offline and the fallback found nothing either.
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isOpen]);

  // A click outside is a dismissal. Without this the list survives the reader
  // moving on to the dates.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  function close() {
    setIsOpen(false);
    setQuery('');
    setOptions([]);
  }

  function choose(airport: Airport) {
    // Remembered so the booking screen can name this airport's city later
    // without a round trip. See `airport.service.ts`.
    airportService.remember(airport);
    setSelected(airport);
    onChange(airport.code);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (options.length === 0) return;

      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
      return;
    }

    if (event.key === 'Enter' && isOpen && options[active]) {
      event.preventDefault();
      choose(options[active]);
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close();
    }
  }

  const listId = `${id}-listbox`;
  // Closed, the field reads as the chosen airport; open, it is what they typed.
  const display = isOpen ? query : selected ? airportService.format(selected) : value;

  return (
    <div className={cx(styles.field, className)} ref={rootRef}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>

      <input
        id={id}
        className={styles.control}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && options[active] ? `${id}-option-${active}` : undefined}
        autoComplete="off"
        value={display}
        placeholder="City or airport"
        onFocus={() => setIsOpen(true)}
        onChange={(event) => {
          setIsOpen(true);
          setQuery(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />

      {isOpen && options.length > 0 ? (
        <ul className={styles.list} id={listId} role="listbox" aria-label={label}>
          {options.map((airport, index) => (
            <li
              key={airport.code}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === active}
              className={cx(styles.option, index === active && styles.active)}
              // `pointerdown` rather than `click`: the input's blur would
              // otherwise close the list before the click ever lands.
              onPointerDown={(event) => {
                event.preventDefault();
                choose(airport);
              }}
              onPointerEnter={() => setActive(index)}
            >
              <span className={styles.code}>{airport.code}</span>
              <span className={styles.place}>
                <span className={styles.city}>{airport.city}</span>
                <span className={styles.name}>{airport.name}</span>
              </span>
              <span className={styles.country}>{airport.countryCode}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {isOpen && query.trim() && options.length === 0 ? (
        <p className={styles.empty}>No airports match “{query.trim()}”.</p>
      ) : null}
    </div>
  );
}
