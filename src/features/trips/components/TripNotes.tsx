import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { EmptyState } from '../../../components/common/EmptyState';
import { IconButton } from '../../../components/common/IconButton';
import { NoteIcon, PlusIcon, TrashIcon } from '../../../components/common/icons';
import type { TripNote } from '../../../types/trip.types';
import { formatShortDate } from '../../../utils/date';
import styles from './TripNotes.module.css';

/** Supplied together, or not at all — see `TripNotesProps.editing`. */
export type NotesEditing = {
  onAdd: () => void;
  onEdit: (noteId: string, text: string) => void;
  onDelete: (noteId: string) => void;
  /** Message for one note, keyed by its id. */
  errors?: Record<string, string>;
  disabled?: boolean;
};

export type TripNotesProps = {
  notes: TripNote[];
  editing?: NotesEditing;
};

/** "Added 3 Aug", or "Edited 3 Aug" once the text has been changed. */
function stamp(note: TripNote): string {
  const edited = note.updatedAt !== note.createdAt;
  return `${edited ? 'Edited' : 'Added'} ${formatShortDate(note.updatedAt.slice(0, 10))}`;
}

/**
 * Reminders kept with the trip — packing lists, things to book, anything the
 * itinerary has no field for.
 *
 * Separate notes rather than one notepad, so a note can be removed once it is
 * done without editing around it. Each is a plain textarea: this is the place
 * for the things that do not fit the structured parts of a trip, so imposing
 * structure here would defeat it.
 */
export function TripNotes({ notes, editing }: TripNotesProps) {
  if (notes.length === 0 && !editing) {
    return (
      <EmptyState
        icon={<NoteIcon size={26} />}
        title="No notes yet"
        description="Reminders, packing lists and anything else you want to keep with this trip. Choose Edit Trip to add one."
      />
    );
  }

  return (
    <div className={styles.notes}>
      {notes.length === 0 ? (
        <p className={styles.empty}>No notes yet. Add one below.</p>
      ) : (
        <ul className={styles.list}>
          {notes.map((note) =>
            editing ? (
              <EditableNote key={note.id} note={note} editing={editing} />
            ) : (
              <li key={note.id}>
                <Card padding="md" elevation="soft" className={styles.card}>
                  {/* Notes are typed with line breaks and the reader means
                      them — see `white-space` in the stylesheet. */}
                  <p className={styles.text}>{note.text}</p>
                  <p className={styles.stamp}>{stamp(note)}</p>
                </Card>
              </li>
            ),
          )}
        </ul>
      )}

      {editing ? (
        <div className={styles.addRow}>
          <Button
            type="button"
            variant="secondary"
            size="md"
            leadingIcon={<PlusIcon size={16} />}
            disabled={editing.disabled}
            onClick={editing.onAdd}
          >
            Add note
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One note as an editable field, in the card the read view would occupy. */
function EditableNote({ note, editing }: { note: TripNote; editing: NotesEditing }) {
  const error = editing.errors?.[note.id];
  // A blank note has no text to name it by, and "Remove" alone is ambiguous
  // once there are several on screen.
  const name = note.text.trim() ? `note “${note.text.trim().slice(0, 30)}”` : 'this empty note';

  return (
    <li>
      <Card padding="md" elevation="soft" className={styles.editCard}>
        <div className={styles.editRow}>
          <textarea
            className={styles.control}
            rows={3}
            value={note.text}
            placeholder="Book airport transfer, pack adapters…"
            onChange={(event) => editing.onEdit(note.id, event.target.value)}
            disabled={editing.disabled}
            aria-label="Note"
          />

          <IconButton
            label={`Remove ${name}`}
            disabled={editing.disabled}
            onClick={() => editing.onDelete(note.id)}
          >
            <TrashIcon size={18} />
          </IconButton>
        </div>

        <p className={styles.stamp}>{stamp(note)}</p>

        {error ? <p className={styles.error}>{error}</p> : null}
      </Card>
    </li>
  );
}
