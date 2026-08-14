import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PlannerMessage } from '../../core/types/planner.types';
import type { TripDraft } from '../../core/types/trip.types';
import { imageSource } from '../../assets/bundled-images';
import { formatDateRange } from '../../core/utils/date';
import { useCurrentUser } from '../../core/hooks/useCurrentUser';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { ArrowUpIcon, CrownIcon } from '../../components/icons';
import { useTheme } from '../../theme/useTheme';
import { usePlanner } from './usePlanner';

/**
 * The planner conversation.
 *
 * Everything under this is the web's own code — `usePlanner`, the rule engine,
 * the tier switch — so what is written here is only how a phone shows it.
 *
 * **A `FlatList`, inverted.** A chat grows downward and a phone keyboard eats
 * the bottom half of the screen, so the list is rendered upside down with the
 * newest message first. That way the thing somebody is reading stays put when
 * the keyboard opens, and no scroll-to-bottom effect is needed — which is the
 * bug the web spent a milestone on.
 */

function Bubble({ message, onSave, saving, savedId }: {
  message: PlannerMessage;
  onSave: (trip: TripDraft) => void;
  saving: boolean;
  savedId: string | undefined;
}) {
  const theme = useTheme();
  const mine = message.author === 'user';

  return (
    <View style={{ marginBottom: theme.space.md }}>
      <View
        style={{
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '85%',
          backgroundColor: mine ? theme.color.primary : theme.color.surface,
          borderColor: theme.color.border,
          borderWidth: mine ? 0 : 1,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.space.lg,
          paddingVertical: theme.space.md,
        }}
      >
        <Text variant="sm" tone={mine ? 'light' : 'main'} leading="base">
          {message.content}
        </Text>
      </View>

      {message.trip ? (
        <TripCard trip={message.trip} onSave={onSave} saving={saving} savedId={savedId} />
      ) : null}
    </View>
  );
}

function TripCard({ trip, onSave, saving, savedId }: {
  trip: TripDraft;
  onSave: (trip: TripDraft) => void;
  saving: boolean;
  savedId: string | undefined;
}) {
  const theme = useTheme();
  const cover = imageSource(trip.coverImage);

  return (
    <Card padding="none" elevation="card" style={{ marginTop: theme.space.md, overflow: 'hidden' }}>
      {cover ? <Image source={cover} style={{ width: '100%', height: 140 }} resizeMode="cover" /> : null}

      <View style={{ padding: theme.space.lg, gap: theme.space.sm }}>
        <Text variant="md" weight="semibold" leading="tight">
          {trip.title}
        </Text>
        <Text variant="xs" tone="muted">
          {formatDateRange(trip.startDate, trip.endDate)} · {trip.travellers} travellers ·{' '}
          {trip.itinerary.length} days
        </Text>

        {savedId ? (
          <Text variant="xs" tone="success" weight="semibold">
            Saved to your trips
          </Text>
        ) : (
          <Button onPress={() => onSave(trip)} loading={saving} disabled={saving} fullWidth>
            Save trip
          </Button>
        )}
      </View>
    </Card>
  );
}

export function PlannerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isPro } = useCurrentUser();
  const { messages, isGenerating, error, savingMessageId, savedTripIdFor, generate, saveTrip } =
    usePlanner();
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<PlannerMessage>>(null);

  // Newest first, because the list is inverted.
  const ordered = [...messages].reverse();

  useEffect(() => {
    if (isGenerating) listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [isGenerating]);

  function send() {
    const prompt = draft.trim();
    if (!prompt || isGenerating) return;

    setDraft('');
    void generate(prompt);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.color.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={listRef}
        inverted
        data={ordered}
        keyExtractor={(message) => message.id}
        contentContainerStyle={{
          paddingTop: theme.space.lg,
          paddingBottom: insets.top + theme.space.lg,
          paddingHorizontal: theme.space.lg,
        }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Bubble
            message={item}
            onSave={(trip) => void saveTrip(item.id, trip)}
            saving={savingMessageId === item.id}
            savedId={savedTripIdFor(item.trip)}
          />
        )}
      />

      <View
        style={{
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.sm,
          paddingBottom: theme.space.sm,
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
          backgroundColor: theme.color.surface,
          gap: theme.space.sm,
        }}
      >
        {error ? (
          <Text variant="xs" tone="danger">
            {error}
          </Text>
        ) : null}

        {/*
          The tier line, for free accounts only — the same sentence the web
          shows above its composer, and gone the moment somebody upgrades.
        */}
        {isPro ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
            <CrownIcon size={13} color={theme.color.primary} />
            <Text variant="xs" tone="muted" leading="snug" style={{ flex: 1 }}>
              Quick planner — builds trips from templates. Pro writes them with Claude.
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm }}>
          <TextInput
            style={{
              flex: 1,
              maxHeight: 120,
              backgroundColor: theme.color.background,
              borderColor: theme.color.border,
              borderWidth: 1,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.space.lg,
              paddingVertical: theme.space.md,
              color: theme.color.textMain,
              fontSize: theme.fontSize.sm,
            }}
            placeholder="Where would you like to go?"
            placeholderTextColor={theme.color.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!isGenerating}
          />

          <TouchableOpacity
            onPress={send}
            disabled={!draft.trim() || isGenerating}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.primary,
              opacity: !draft.trim() || isGenerating ? 0.5 : 1,
            }}
          >
            <ArrowUpIcon size={20} color={theme.color.textLight} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
