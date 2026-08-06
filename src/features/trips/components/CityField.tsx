import { useEffect, useId, useRef, useState } from 'react';
import { cx } from '../../../utils/cx';
import styles from './CityField.module.css';

export type CityFieldProps = {
  id: string;
  /** The committed city name. Free text is allowed — the list is a shortcut. */
  value: string;
  onChange: (city: string) => void;
  /** Type-ahead over the loaded city list. `''` asks for the unfiltered top. */
  suggest: (query: string) => string[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** The form's own control class, so this reads as one of its fields. */
  className?: string;
};

/**
 * City picker for the trip form.
 *
 * Replaces the `<input list>` + `<datalist>` this used to be. A datalist is
 * filtered by the browser against the input's whole value, so once a city was
 * chosen the list collapsed to the one entry that matched it — there was no
 * way back to the others without clearing the box by hand. The country next
 * to it is a `<select>` that reopens on the full list every time, and this
 * needs to behave the same.
 *
 * So: opening shows the unfiltered list whatever is already in the box, and
 * filtering starts at the first keystroke. Built as an ARIA combobox for the
 * same reason `AirportField` is — the country list is about 200 and belongs
 * in a `<select>`, but France alone returns close to 16,000 cities, which is
 * why this stays a text box over a capped set of matches.
 */
export function CityField({
  id,
  value,
  onChange,
  suggest,
  placeholder,
  disabled,
  invalid,
  describedBy,
  className,
}: CityFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  // False right after opening, so the chosen city does not filter itself out
  // of its own list. The first keystroke turns it on.
  const [isFiltering, setIsFiltering] = useState(false);
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const listId = `${useId()}-cities`;

  // A click outside is a dismissal.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  const options = isOpen ? suggest(isFiltering ? value : '') : [];

  function open() {
    setIsOpen(true);
    setIsFiltering(false);
    // Land on the current city when there is one, so arrowing starts from
    // where the reader already is rather than from the top of the list.
    const index = suggest('').indexOf(value);
    setActive(index === -1 ? 0 : index);
  }

  function close() {
    setIsOpen(false);
    setIsFiltering(false);
  }

  function choose(city: string) {
    onChange(city);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        open();
        return;
      }
      if (options.length === 0) return;

      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
      return;
    }

    if (event.key === 'Enter' && isOpen && options[active]) {
      // The form must not submit on the keystroke that picks a city.
      event.preventDefault();
      choose(options[active]);
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close();
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <input
        id={id}
        className={cx(styles.control, className)}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && options[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={open}
        onClick={() => {
          if (!isOpen) open();
        }}
        onChange={(event) => {
          setIsOpen(true);
          setIsFiltering(true);
          setActive(0);
          onChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />

      {isOpen && options.length > 0 ? (
        <ul className={styles.list} id={listId} role="listbox" aria-label="Cities">
          {options.map((city, index) => (
            <li
              key={city}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={city === value}
              className={cx(styles.option, index === active && styles.active)}
              // `pointerdown` rather than `click`: the input's blur would
              // otherwise close the list before the click ever lands.
              onPointerDown={(event) => {
                event.preventDefault();
                choose(city);
              }}
              onPointerEnter={() => setActive(index)}
            >
              {city}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
