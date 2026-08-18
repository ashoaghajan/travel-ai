import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';
import type { ApiPerson, FriendStatus } from '@ai-travel/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { friendService } from '../../core/services/friend.service';
import {
  friendStore,
  useFriendRequests,
  useFriends,
  useFriendsResource,
} from '../../core/store/friend.store';
import { useTheme } from '../../theme/useTheme';
import { PersonRow } from './PersonRow';
import { useFriendActions } from './useFriendActions';
import type { FriendActions } from './useFriendActions';

/** Long enough that typing a name is one query rather than five. */
const SEARCH_DEBOUNCE_MS = 250;

/** Where the reader stands with somebody, said in words rather than by a verb. */
const STANDING: Record<FriendStatus, string | undefined> = {
  none: undefined,
  outgoing: 'Waiting for an answer',
  incoming: 'Wants to be friends',
  friends: 'Friends',
};

/** "Friends since 2 August" — the day, not the minute. */
function sinceLabel(iso: string): string {
  return `Friends since ${new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })}`;
}

/**
 * Friends, requests and everybody else — one screen, three sections.
 *
 * The web's `FriendsPage`, and one screen for the same reason it gives: they
 * are one task seen from three angles, and somebody who has just accepted a
 * request wants to watch their friend list change. **Incoming requests come
 * first**, because they are the only part of this screen where somebody is
 * waiting on the reader.
 *
 * Everything below the presentation is the web's own code — `friendStore`,
 * `friendService` and `useFriendActions` are the same files — so what differs
 * is only what a phone forces. The web's skeleton placeholders are spinners
 * with a line of text: a skeleton is a promise about a layout, and at this
 * width the layout is one column of rows that a spinner describes just as
 * honestly for a fraction of the code.
 */
export function FriendsScreen() {
  const theme = useTheme();
  const friends = useFriends();
  const { status } = useFriendsResource();
  const requests = useFriendRequests();
  const actions = useFriendActions();

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

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="xl" weight="bold" leading="tight">
          Friends
        </Text>
        <Text variant="sm" tone="muted" leading="snug">
          You can message the people you are friends with.
        </Text>
      </View>

      {actions.error ? (
        <Text variant="sm" tone="danger" accessibilityRole="alert">
          {actions.error}
        </Text>
      ) : null}

      {requests.incoming.length > 0 ? (
        <Section title="Waiting for you" count={requests.incoming.length}>
          {requests.incoming.map((request) => (
            <PersonRow key={request.id} name={request.name} standing="Wants to be friends">
              <Button
                disabled={actions.busyId === request.id}
                onPress={() => void actions.accept(request.id)}
              >
                Accept
              </Button>
              <Button
                variant="secondary"
                disabled={actions.busyId === request.id}
                onPress={() => void actions.remove(request.id)}
              >
                Decline
              </Button>
            </PersonRow>
          ))}
        </Section>
      ) : null}

      {requests.outgoing.length > 0 ? (
        <Section title="Asked">
          {requests.outgoing.map((request) => (
            <PersonRow key={request.id} name={request.name} standing="Waiting for an answer">
              <Button
                variant="secondary"
                disabled={actions.busyId === request.id}
                onPress={() => void actions.remove(request.id)}
              >
                Cancel
              </Button>
            </PersonRow>
          ))}
        </Section>
      ) : null}

      <Section title="Your friends" count={friends.length || undefined}>
        {status === 'loading' && friends.length === 0 ? <Waiting label="Loading your friends…" /> : null}

        {status === 'ready' && friends.length === 0 ? (
          <Text variant="sm" tone="muted" leading="snug">
            Nobody yet. Find somebody below, and you can message them once they accept.
          </Text>
        ) : null}

        {friends.map((friend) => (
          <PersonRow key={friend.id} name={friend.name} standing={sinceLabel(friend.since)}>
            <RemoveFriend
              name={friend.name}
              isBusy={actions.busyId === friend.id}
              onConfirm={() => void actions.remove(friend.id)}
            />
          </PersonRow>
        ))}
      </Section>

      {/*
        Everybody, not only the strangers — the web's reasoning, unchanged: it
        used to hide anyone already on a list above, which made the question
        "who else is here?" unanswerable from the one screen that should answer
        it. Each row says where things stand and offers the one thing left to
        do about it.
      */}
      <Section
        title="Everybody on AI Travel"
        count={people && people.length > 0 ? people.length : undefined}
      >
        <TextInput
          style={{
            backgroundColor: theme.color.background,
            borderColor: theme.color.border,
            borderWidth: 1,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.space.lg,
            paddingVertical: theme.space.md,
            color: theme.color.textMain,
            fontSize: theme.fontSize.sm,
          }}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name…"
          placeholderTextColor={theme.color.textMuted}
          accessibilityLabel="Search for someone by name"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />

        {people === null || (isSearching && people.length === 0) ? (
          <Waiting label="Searching…" />
        ) : people.length === 0 ? (
          <Text variant="sm" tone="muted" leading="snug">
            {query ? `Nobody here is called “${query}”.` : 'Nobody else has signed up yet.'}
          </Text>
        ) : (
          people.map((person) => (
            <PersonRow key={person.id} name={person.name} standing={STANDING[person.status]}>
              <PersonAction person={person} actions={actions} />
            </PersonRow>
          ))
        )}
      </Section>
    </Screen>
  );
}

/** A titled card, with the count the web puts in a pill beside the heading. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();

  return (
    <Card padding="lg" elevation="soft">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
          marginBottom: theme.space.sm,
        }}
      >
        <Text variant="md" weight="semibold" leading="tight">
          {title}
        </Text>

        {count === undefined ? null : (
          <View
            style={{
              minWidth: 24,
              paddingHorizontal: theme.space.sm,
              paddingVertical: 2,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.primarySoft,
              alignItems: 'center',
            }}
          >
            <Text variant="xs" weight="semibold" tone="primary" leading="tight">
              {count}
            </Text>
          </View>
        )}
      </View>

      <View style={{ gap: theme.space.sm }}>{children}</View>
    </Card>
  );
}

/** What stands in for the web's skeleton rows. */
function Waiting({ label }: { label: string }) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="progressbar"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.sm }}
    >
      <ActivityIndicator size="small" color={theme.color.textMuted} />
      <Text variant="sm" tone="muted" leading="tight">
        {label}
      </Text>
    </View>
  );
}

/**
 * The one thing left to do about somebody, given where things stand.
 *
 * Four states and four answers: ask, take the asking back, answer theirs, or —
 * for an existing friend — nothing at all. Removing a friend is deliberately
 * absent here: it belongs beside the friend, in the list above, rather than in
 * a directory somebody is scanning to *add* people.
 */
function PersonAction({ person, actions }: { person: ApiPerson; actions: FriendActions }) {
  const isBusy = actions.busyId === person.id;

  if (person.status === 'friends') return null;

  if (person.status === 'incoming') {
    return (
      <>
        <Button disabled={isBusy} onPress={() => void actions.accept(person.id)}>
          Accept
        </Button>
        <Button variant="secondary" disabled={isBusy} onPress={() => void actions.remove(person.id)}>
          Decline
        </Button>
      </>
    );
  }

  if (person.status === 'outgoing') {
    return (
      <Button variant="secondary" disabled={isBusy} onPress={() => void actions.remove(person.id)}>
        Cancel
      </Button>
    );
  }

  return (
    <Button disabled={isBusy} onPress={() => void actions.add(person.id)}>
      Add friend
    </Button>
  );
}

/**
 * Removing a friend, behind one confirmation.
 *
 * Quiet, unhurried, and it takes a conversation off both screens — exactly the
 * shape of action that should not happen on a slipped tap. The confirm is
 * inline rather than a dialog, as on the web: it is one sentence, and a modal
 * for it would be heavier than the thing it guards. On a phone that also keeps
 * the reader in the list, which a modal would cover.
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
      <Button variant="secondary" onPress={() => setIsConfirming(true)}>
        Remove
      </Button>
    );
  }

  return (
    <>
      <Text variant="sm" tone="muted" leading="tight">
        Remove {name}?
      </Text>
      <Button variant="danger" loading={isBusy} onPress={onConfirm}>
        Remove
      </Button>
      <Button variant="secondary" disabled={isBusy} onPress={() => setIsConfirming(false)}>
        Keep
      </Button>
    </>
  );
}
