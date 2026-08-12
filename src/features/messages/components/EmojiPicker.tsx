import { useEffect, useId, useRef, useState } from 'react';
import { IconButton } from '../../../components/common/IconButton';
import { SmileyIcon } from '../../../components/common/icons';
import styles from './EmojiPicker.module.css';

/**
 * A short list, chosen rather than generated.
 *
 * The full emoji set is some 3,800 characters and needs search, categories,
 * skin-tone variants and a virtualised grid to be usable — which is a library,
 * and a library here would be ~100KB on a panel that mounts on every page. This
 * is the two dozen a traveller actually reaches for, in one screenful, with the
 * keyboard still available for everything else.
 *
 * Grouped loosely by what they are for, because the order is what makes a grid
 * scannable and alphabetical is meaningless for pictures.
 */
const EMOJI: readonly { char: string; name: string }[] = [
  { char: '👍', name: 'thumbs up' },
  { char: '🙏', name: 'thank you' },
  { char: '👋', name: 'wave' },
  { char: '🎉', name: 'celebrate' },
  { char: '🔥', name: 'fire' },
  { char: '❤️', name: 'heart' },
  { char: '😀', name: 'grin' },
  { char: '😂', name: 'laughing' },
  { char: '🙂', name: 'smile' },
  { char: '😍', name: 'in love' },
  { char: '😎', name: 'cool' },
  { char: '🤔', name: 'thinking' },
  { char: '😅', name: 'relieved' },
  { char: '😴', name: 'sleepy' },
  { char: '😭', name: 'crying' },
  { char: '🤷', name: 'shrug' },
  { char: '✈️', name: 'plane' },
  { char: '🏖️', name: 'beach' },
  { char: '🏔️', name: 'mountain' },
  { char: '🗺️', name: 'map' },
  { char: '📍', name: 'pin' },
  { char: '🧳', name: 'luggage' },
  { char: '🏨', name: 'hotel' },
  { char: '🚕', name: 'taxi' },
  { char: '☀️', name: 'sun' },
  { char: '🌧️', name: 'rain' },
  { char: '🍕', name: 'food' },
  { char: '☕', name: 'coffee' },
  { char: '🍷', name: 'wine' },
  { char: '📷', name: 'camera' },
  { char: '💸', name: 'money' },
  { char: '⏰', name: 'time' },
];

export type EmojiPickerProps = {
  onPick: (emoji: string) => void;
  disabled?: boolean;
};

/**
 * The emoji button beside the composer, and the grid behind it.
 *
 * Built as the account menu is: a trigger, a popover, dismissal on a click
 * outside or Escape, and focus handed back to the trigger on the way out. A
 * picker you cannot close without the mouse is worse than no picker.
 *
 * Picking does **not** close it. Sending three emoji in a row is the common
 * case, and reopening between each one is three extra clicks for nothing.
 */
export function EmojiPicker({ onPick, disabled = false }: EmojiPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const gridId = useId();

  // Opening with the keyboard has to land somewhere.
  useEffect(() => {
    if (isOpen) firstRef.current?.focus();
  }, [isOpen]);

  // A click anywhere else is a dismissal.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !isOpen) return;

        event.preventDefault();
        // Stopped here so Escape closes the picker rather than the dialog the
        // whole panel sits in on a phone.
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <IconButton
        ref={triggerRef}
        label={isOpen ? 'Close emoji' : 'Add an emoji'}
        aria-expanded={isOpen}
        aria-controls={isOpen ? gridId : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
      >
        <SmileyIcon size={18} />
      </IconButton>

      {isOpen ? (
        <div className={styles.popover} id={gridId} role="group" aria-label="Emoji">
          {EMOJI.map((emoji, index) => (
            <button
              key={emoji.char}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className={styles.emoji}
              // The character itself is not a name a screen reader can read
              // usefully, so the button carries one and hides the picture.
              aria-label={emoji.name}
              onClick={() => onPick(emoji.char)}
            >
              <span aria-hidden="true">{emoji.char}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
