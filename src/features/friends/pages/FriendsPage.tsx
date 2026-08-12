import { useEffect, useId, useRef, useState } from 'react';
import type { ApiPerson } from '@ai-travel/shared';
import { Button } from '../../../components/common/Button';
import { Card } from '../../../components/common/Card';
import { PageHeader } from '../../../components/layout/PageHeader';
import { Skeleton } from '../../../components/common/Skeleton';
import { friendService } from '../../../services/friend.service';
import {
  friendStore,
  useFriendRequests,
  useFriends,
  useFriendsResource,
} from '../../../store/friend.store';
import { PersonRow } from '../components/PersonRow';
import { useFriendActions } from '../useFriendActions';
import styles from './FriendsPage.module.css';

/** Long enough that typing a name is one query rather than five. */
const SEARCH_DEBOUNCE_MS = 250;

/** "Friends since 2 August" — the day, not the minute. */
function sinceLabel(iso: string): string {
  return `Friends since ${new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })}`;
}

/**
 * Friends, requests and everybody else — one page, three sections.
 *
 * One page rather than three routes because they are one task seen from three
 * angles: somebody who has just accepted a request wants to watch their friend
 * list change, and somebody who has just added a stranger wants to see the
 * request they now have outstanding.
 *
 * **Incoming requests come first**, because they are the only part of this
 * screen where somebody is waiting on the reader.
 */
export function FriendsPage() {
  const friends = useFriends();
  const { status } = useFriendsResource();
  const requests = useFriendRequests();
  const actions = useFriendActions();

  const searchId = useId();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<ApiPerson[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  /*
   * Reading a resource loads it, so a first visit needs nothing here.
   *
   * A *revisit* does: the lists are already held from last time, and somebody
   * may have asked to be friends since. Asking unconditionally would make
   * every first visit fetch all three lists twice — once because the hooks
   * subscribed and once because of this.
   */
  const wasLoaded = useRef(status !== 'idle');
  useEffect(() => {
    if (wasLoaded.current) void friendStore.refresh();
  }, []);

  /*
   * The directory, debounced.
   *
   * Re-run when a relationship changes as well as when the query does: adding
   * somebody from these results has to take that row off the list without the
   * reader typing again. Keyed on the counter rather than on the friend and
   * request arrays — an effect keyed on an array is keyed on its identity,
   * which is a property of how a fetch happened to be answered.
   */
  useEffect(() => {
    let cancelled = false;
    setIsSearching(true);

    const timer = setTimeout(() => {
      void friendService.searchPeople(query || undefined).then(
        (found) => {
          if (cancelled) return;
          setPeople(found);
          setIsSearching(false);
        },
        () => {
          if (cancelled) return;
          setPeople([]);
          setIsSearching(false);
        },
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, actions.changedAt]);

  /* Already on one of the lists above; showing them a third time is noise. */
  const strangers = (people ?? []).filter((person) => person.status === 'none');

  return (
    <div className={styles.page}>
      <PageHeader
        title="Friends"
        subtitle="You can message the people you are friends with."
      />

      <div className={styles.content}>
        {actions.error ? (
          <p className={styles.error} role="alert">
            {actions.error}
          </p>
        ) : null}

        {requests.incoming.length > 0 ? (
          <Card padding="lg" elevation="soft" as="section">
            <h2 className={styles.heading}>
              Waiting for you
              <span className={styles.count}>{requests.incoming.length}</span>
            </h2>

            <ul className={styles.list}>
              {requests.incoming.map((request) => (
                <PersonRow key={request.id} name={request.name} standing="Wants to be friends">
                  <Button
                    variant="primary"
                    size="md"
                    disabled={actions.busyId === request.id}
                    onClick={() => void actions.accept(request.id)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={actions.busyId === request.id}
                    onClick={() => void actions.remove(request.id)}
                  >
                    Decline
                  </Button>
                </PersonRow>
              ))}
            </ul>
          </Card>
        ) : null}

        {requests.outgoing.length > 0 ? (
          <Card padding="lg" elevation="soft" as="section">
            <h2 className={styles.heading}>Asked</h2>

            <ul className={styles.list}>
              {requests.outgoing.map((request) => (
                <PersonRow key={request.id} name={request.name} standing="Waiting for an answer">
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={actions.busyId === request.id}
                    onClick={() => void actions.remove(request.id)}
                  >
                    Cancel
                  </Button>
                </PersonRow>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card padding="lg" elevation="soft" as="section">
          <h2 className={styles.heading}>
            Your friends
            {friends.length > 0 ? <span className={styles.count}>{friends.length}</span> : null}
          </h2>

          {status === 'loading' && friends.length === 0 ? (
            <div className={styles.loading} aria-busy="true">
              <span className="visually-hidden">Loading your friends…</span>
              <Skeleton height="44px" radius="lg" />
              <Skeleton height="44px" radius="lg" />
            </div>
          ) : null}

          {status === 'ready' && friends.length === 0 ? (
            <p className={styles.empty}>
              Nobody yet. Find somebody below, and you can message them once they accept.
            </p>
          ) : null}

          <ul className={styles.list}>
            {friends.map((friend) => (
              <PersonRow key={friend.id} name={friend.name} standing={sinceLabel(friend.since)}>
                <RemoveFriend
                  name={friend.name}
                  isBusy={actions.busyId === friend.id}
                  onConfirm={() => void actions.remove(friend.id)}
                />
              </PersonRow>
            ))}
          </ul>
        </Card>

        <Card padding="lg" elevation="soft" as="section">
          <h2 className={styles.heading}>Find people</h2>

          <div className={styles.search}>
            <label className="visually-hidden" htmlFor={searchId}>
              Search for someone by name
            </label>
            <input
              id={searchId}
              type="search"
              className={styles.field}
              value={query}
              placeholder="Search by name…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {people === null || (isSearching && strangers.length === 0) ? (
            <div className={styles.loading} aria-busy="true">
              <span className="visually-hidden">Searching…</span>
              <Skeleton height="44px" radius="lg" />
            </div>
          ) : strangers.length === 0 ? (
            <p className={styles.empty}>
              {query
                ? `Nobody here is called “${query}”.`
                : 'You are friends with everybody who has signed up.'}
            </p>
          ) : (
            <ul className={styles.list}>
              {strangers.map((person) => (
                <PersonRow key={person.id} name={person.name}>
                  <Button
                    variant="primary"
                    size="md"
                    disabled={actions.busyId === person.id}
                    onClick={() => void actions.add(person.id)}
                  >
                    Add friend
                  </Button>
                </PersonRow>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Removing a friend, behind one confirmation.
 *
 * Quiet, unhurried, and it takes a conversation off both screens — exactly the
 * shape of action that should not happen on a slipped click. The confirm is
 * inline rather than a dialog: it is one sentence, and a modal for it would be
 * heavier than the thing it guards.
 */
function RemoveFriend({
  name,
  isBusy,
  onConfirm,
}: {
  name: string;
  isBusy: boolean;
  onConfirm: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);

  if (!isConfirming) {
    return (
      <Button variant="secondary" size="md" onClick={() => setIsConfirming(true)}>
        Remove
      </Button>
    );
  }

  return (
    <>
      <span className={styles.confirmText}>Remove {name}?</span>
      <Button variant="danger" size="md" disabled={isBusy} onClick={onConfirm}>
        {isBusy ? 'Removing…' : 'Remove'}
      </Button>
      <Button variant="secondary" size="md" onClick={() => setIsConfirming(false)}>
        Keep
      </Button>
    </>
  );
}
