import type { SVGProps } from 'react';

/**
 * Inline SVG icon set — no icon library dependency.
 *
 * Icons are decorative by default (`aria-hidden`), inherit `currentColor`, and
 * are sized through the `size` prop so they scale with the surrounding token.
 */
export type IconProps = SVGProps<SVGSVGElement> & {
  /** Width and height in pixels. */
  size?: number;
};

function Icon({ size = 24, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Brand mark glyph — a paper plane. */
export function PlaneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.2 3.3 2.9 10.1c-.8.3-.8 1.4 0 1.7l6.6 2.4 2.4 6.6c.3.8 1.4.8 1.7 0l6.8-18.3c.3-.7-.4-1.5-1.2-1.2Z" />
      <path d="m21.2 3.3-11.7 11" />
    </Icon>
  );
}

/** Smart Itineraries. */
export function SparklesIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 13.7 8l4.5 1.7-4.5 1.7L12 15.9l-1.7-4.5L5.8 9.7 10.3 8 12 3.5Z" />
      <path d="M18.5 15.5 19.3 17.7l2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
      <path d="M5 3.5 5.6 5.1l1.6.6-1.6.6L5 7.9l-.6-1.6-1.6-.6 1.6-.6L5 3.5Z" />
    </Icon>
  );
}

/** Real-time Options. */
export function BoltIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.4 2.5 4.9 13a.7.7 0 0 0 .5 1.1h5l-1.3 7.4 8.5-10.5a.7.7 0 0 0-.5-1.1h-5l1.3-7.4Z" />
    </Icon>
  );
}

/** Book with Confidence. */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.8 19 5.6v5.6c0 4.3-2.9 8.2-7 9.4-4.1-1.2-7-5.1-7-9.4V5.6l7-2.8Z" />
      <path d="m9 11.8 2.1 2.1L15.2 9.8" />
    </Icon>
  );
}

/** Sidebar: Home. */
export function HomeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 10.6 12 3.8l8.5 6.8" />
      <path d="M5.6 9.4V19a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.4" />
      <path d="M9.8 20.4v-5.6h4.4v5.6" />
    </Icon>
  );
}

/** Sidebar: Trips. */
export function SuitcaseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 8.2h14.8a1 1 0 0 1 1 1v9.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6V9.2a1 1 0 0 1 1-1Z" />
      <path d="M9 8.2V5.8a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 5.8v2.4" />
      <path d="M3.6 13.4h16.8" />
    </Icon>
  );
}

/** Sidebar: Explore. */
export function CompassIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m15.6 8.4-2.3 5-5 2.2 2.3-5 5-2.2Z" />
    </Icon>
  );
}

/** Sidebar: Bookings. */
export function TicketIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.6 9.4V7.6a1.4 1.4 0 0 1 1.4-1.4h14a1.4 1.4 0 0 1 1.4 1.4v1.8a2.6 2.6 0 0 0 0 5.2v1.8a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4v-1.8a2.6 2.6 0 0 0 0-5.2Z" />
      <path d="M14.4 7v2M14.4 11v2M14.4 15v2" />
    </Icon>
  );
}

/** Sidebar: Profile, and the avatar fallback. */
export function UserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 20c0-3.5 3.2-5.4 7.2-5.4s7.2 1.9 7.2 5.4" />
    </Icon>
  );
}

/** Account menu: the way out. */
export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5" />
      <path d="M10.2 15.8 6.4 12l3.8-3.8" />
      <path d="M6.4 12h8.6" />
    </Icon>
  );
}

/** Sidebar: Settings. */
export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.6 12c0-.5-.1-.9-.2-1.4l1.9-1.4-1.9-3.3-2.2 1a7.4 7.4 0 0 0-2.4-1.4L14.5 3h-3.8l-.3 2.5a7.4 7.4 0 0 0-2.4 1.4l-2.2-1L3.9 9.2l1.9 1.4a7.6 7.6 0 0 0 0 2.8L3.9 14.8l1.9 3.3 2.2-1c.7.6 1.5 1.1 2.4 1.4l.3 2.5h3.8l.3-2.5c.9-.3 1.7-.8 2.4-1.4l2.2 1 1.9-3.3-1.9-1.4c.1-.5.2-.9.2-1.4Z" />
    </Icon>
  );
}

/** Start a new trip. */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

/** Header action: share. */
export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.4V3.6" />
      <path d="m8.2 7.4 3.8-3.8 3.8 3.8" />
      <path d="M5.4 12.8V19a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6v-6.2" />
    </Icon>
  );
}

/** Header action: bookmark. */
export function BookmarkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.6 4.6a1 1 0 0 1 1-1h8.8a1 1 0 0 1 1 1v15.8l-5.4-3.9-5.4 3.9Z" />
    </Icon>
  );
}

/** Planner send button. */
export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19.4V5" />
      <path d="m5.8 11.2 6.2-6.2 6.2 6.2" />
    </Icon>
  );
}

/** Upgrade to Pro. */
export function CrownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.4 17.8h15.2" />
      <path d="M3.8 7.2 4.9 15h14.2l1.1-7.8-4.6 3L12 4.6l-3.6 5.6-4.6-3Z" />
    </Icon>
  );
}

/** Messages — people talking to each other. */
export function ChatBubbleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20.4 12.6a7.4 7.4 0 0 1-7.9 7.4c-.9-.1-1.8-.3-2.6-.7l-4.3 1.1 1.1-4.3a7.4 7.4 0 0 1-.7-2.6 7.4 7.4 0 0 1 7.4-7.9 7.4 7.4 0 0 1 7 7Z" />
      <path d="M9.4 12h.01M13 12h.01M16.6 12h.01" />
    </Icon>
  );
}

/** Dismiss a panel or dialog. */
export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" />
    </Icon>
  );
}

/** Export a trip to a file. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v10.4" />
      <path d="m7.4 10.2 4.6 4.6 4.6-4.6" />
      <path d="M4.6 16.4v1.8a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-1.8" />
    </Icon>
  );
}

/** Import a trip from a file — `DownloadIcon` with the arrow reversed. */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14.4V4" />
      <path d="m7.4 8.6 4.6-4.6 4.6 4.6" />
      <path d="M4.6 16.4v1.8a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-1.8" />
    </Icon>
  );
}

/** Destructive action: delete a saved trip. */
export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 6.6h14.8" />
      <path d="M9.2 6.6V5.2a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v1.4" />
      <path d="M6.4 6.6 7.2 19a1.4 1.4 0 0 0 1.4 1.3h6.8a1.4 1.4 0 0 0 1.4-1.3l.8-12.4" />
      <path d="M10.4 10.2v6M13.6 10.2v6" />
    </Icon>
  );
}

/** Back to the trips list. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 12h-15" />
      <path d="m11 5.5-6.5 6.5 6.5 6.5" />
    </Icon>
  );
}

/** Itinerary stop / map marker. */
export function MapPinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21c4.2-4.4 6.3-7.7 6.3-10.2a6.3 6.3 0 1 0-12.6 0C5.7 13.3 7.8 16.6 12 21Z" />
      <circle cx="12" cy="10.6" r="2.4" />
    </Icon>
  );
}

/** Trip dates. */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 6.4h14.8a1 1 0 0 1 1 1v11.2a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4V7.4a1 1 0 0 1 1-1Z" />
      <path d="M8.2 3.8v4M15.8 3.8v4M3.6 10.8h16.8" />
    </Icon>
  );
}

/** Traveller count. */
export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9.6" cy="8.4" r="3.2" />
      <path d="M3.6 19.6c0-3.1 2.7-4.8 6-4.8s6 1.7 6 4.8" />
      <path d="M16.2 5.6a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.6 15.2c1.8.5 2.8 1.7 2.8 3.4" />
    </Icon>
  );
}

/** What a trip costs — the meta row on a trip card. */
export function WalletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      <path d="M18.5 10.5h2v4h-2a2 2 0 0 1 0-4z" />
    </Icon>
  );
}

/** Notes tab. */
export function NoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.8h9.4L19 7.4v12.2a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4V5.2A1.4 1.4 0 0 1 6 3.8Z" />
      <path d="M15 3.9V7.6h3.7M8.2 12h7.6M8.2 15.6h5.2" />
    </Icon>
  );
}

/** Hotel rating. Filled rather than stroked so it reads at small sizes. */
export function StarIcon({ size = 24, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8L12 3.6Z" />
    </svg>
  );
}

/** Hotel list: filter control. */
export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.6h16M7 12h10M10 17.4h4" />
    </Icon>
  );
}

/** Hotel list: sort control. */
export function SortIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.4 4.6v14.8M4 8l3.4-3.4L10.8 8" />
      <path d="M16.6 19.4V4.6M13.2 16l3.4 3.4L20 16" />
    </Icon>
  );
}

/** Hotel list: map toggle. */
export function MapIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.2 4.6 4 6.8v12.6l5.2-2.2 5.6 2.2 5.2-2.2V4.6l-5.2 2.2Z" />
      <path d="M9.2 4.6v12.6M14.8 6.8v12.6" />
    </Icon>
  );
}

/** Signals an action that would leave the app, e.g. a partner site. */
export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4.6h5.4V10" />
      <path d="M19.4 4.6 11 13" />
      <path d="M18 14v5a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4V7.4A1.4 1.4 0 0 1 5 6h5" />
    </Icon>
  );
}

/** A step already taken — stands in for its number in the flight stepper. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.8 12.5 4.8 4.8L19.2 7.7" />
    </Icon>
  );
}

/** Trailing affordance on the primary call to action. */
export function ArrowRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 12h15" />
      <path d="m13 5.5 6.5 6.5-6.5 6.5" />
    </Icon>
  );
}
