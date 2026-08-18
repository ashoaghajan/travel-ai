import { View } from 'react-native';
import type { ReactNode } from 'react';
import { Avatar } from '../../components/Avatar';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';

export type PersonRowProps = {
  name: string;
  /** Where the reader stands, in words. "Friends", "You asked", "Wants to be friends". */
  standing?: string;
  /** The buttons for this row. */
  children?: ReactNode;
};

/**
 * One person, on any of this screen's three lists.
 *
 * The web's `PersonRow`, with its reasoning intact: shared because the three
 * lists differ only in their verbs, and the standing is written out rather
 * than left to be inferred from a button's label.
 *
 * **The buttons wrap onto their own line here, where the web keeps them
 * inline.** A phone has room for a name or for "Accept" and "Decline", not
 * both, and a row that squeezes the name to fit its buttons makes the list
 * unreadable in exactly the case — a pile of requests — where reading it
 * matters. So the actions are given a row of their own, aligned under the
 * name rather than under the avatar.
 */
export function PersonRow({ name, standing, children }: PersonRowProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.space.sm, paddingVertical: theme.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
        <Avatar name={name} size="sm" />

        {/* `flex: 1` so a long name truncates rather than pushing the row wide. */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="sm" weight="semibold" leading="tight" numberOfLines={1}>
            {name}
          </Text>
          {standing ? (
            <Text variant="xs" tone="muted" leading="tight">
              {standing}
            </Text>
          ) : null}
        </View>
      </View>

      {children ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space.sm,
            // Indented to the avatar's width plus the gap, so the buttons read
            // as belonging to the name above them rather than to the list.
            paddingLeft: 32 + theme.space.md,
          }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
