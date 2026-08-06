/** "28h 45m", or "12h" when it lands on the hour. */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** "Direct" / "1 stop" / "2 stops" */
export function formatStops(stops: number): string {
  if (stops === 0) return 'Direct';
  return `${stops} ${stops === 1 ? 'stop' : 'stops'}`;
}
