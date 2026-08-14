import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';

/**
 * Three dots, while an answer is on its way.
 *
 * It earns its place only on the Pro tier, and that is worth stating: the free
 * planner answers from templates in a few milliseconds, so an indicator there
 * would flash and vanish. A model reply takes seconds and arrives a word at a
 * time, and the gap before the first word is the one moment somebody wonders
 * whether the app heard them.
 *
 * `useNativeDriver`, so the animation runs on the UI thread and keeps moving
 * while JavaScript is busy parsing stream frames — which is exactly when it is
 * on screen, and exactly when a JS-driven animation would stutter and look
 * like the app had hung.
 */
export function TypingIndicator() {
  const theme = useTheme();
  /*
   * One ref holding the array, not an array of refs.
   *
   * Three `useRef` calls give three stable values wrapped in a *new array*
   * every render, so the effect below — which depends on it — would tear the
   * animation down and start it again on each one. On the Pro tier that is
   * every stream frame: the dots would reset dozens of times a second and
   * appear frozen.
   */
  const dots = useRef([
    new Animated.Value(0.3),
    new Animated.Value(0.3),
    new Animated.Value(0.3),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 160),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    animations.forEach((animation) => animation.start());

    // Stopped rather than left running: this unmounts the moment the answer
    // finishes, and a loop nobody stops keeps a timer alive behind it.
    return () => animations.forEach((animation) => animation.stop());
  }, [dots]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Writing a reply"
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        gap: 5,
        alignItems: 'center',
        backgroundColor: theme.color.surface,
        borderColor: theme.color.border,
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        paddingHorizontal: theme.space.lg,
        paddingVertical: theme.space.md,
        marginBottom: theme.space.md,
      }}
    >
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.color.textMuted,
            opacity: dot,
          }}
        />
      ))}
    </View>
  );
}
