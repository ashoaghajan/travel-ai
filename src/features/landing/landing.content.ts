import type { ComponentType } from 'react';
import { BoltIcon, ShieldCheckIcon, SparklesIcon } from '../../components/common/icons';
import type { IconProps } from '../../components/common/icons';

/** Hero copy, verbatim from DESIGN_SPEC Screen 1. */
export const LANDING_HERO = {
  headline: 'Your AI Travel Planner',
  subtitleLines: ['Plan the perfect trip in minutes.', 'Customised. Smart. Effortless.'],
  primaryCta: 'Get Started',
  secondaryCta: 'Sign In',
  /**
   * Replaces both of the above once there is a session. Not in the spec, which
   * only describes the page as a visitor first meets it — but a signed-in
   * reader offered "Get Started" and "Sign In" has nowhere to go.
   */
  authenticatedCta: 'Go to Planner',
} as const;

export type LandingFeature = {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<IconProps>;
};

/** The three feature cards named in DESIGN_SPEC Screen 1. */
export const LANDING_FEATURES: LandingFeature[] = [
  {
    id: 'smart-itineraries',
    title: 'Smart Itineraries',
    description: 'Describe the trip you want and get a complete day-by-day plan in seconds.',
    icon: SparklesIcon,
  },
  {
    id: 'real-time-options',
    title: 'Real-time Options',
    description: 'Compare flights, stays and activities side by side, all in one place.',
    icon: BoltIcon,
  },
  {
    id: 'book-with-confidence',
    title: 'Book with Confidence',
    description: 'Finish your booking with trusted travel partners you already know.',
    icon: ShieldCheckIcon,
  },
];
