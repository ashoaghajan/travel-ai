import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './calendar';
import { foldLine, toGoogleCalendarUrl, toIcsCalendar } from './ics';

const NOW = new Date('2026-09-02T13:00:00.000Z');

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'activity_1@ai-travel',
    title: 'Khinkali',
    description: 'Off Shavteli.',
    start: '2026-09-14T19:30:00',
    end: '2026-09-14T20:30:00',
    timeZone: 'Asia/Tbilisi',
    location: 'Tbilisi',
    ...overrides,
  };
}

function lines(ics: string): string[] {
  return ics.split('\r\n');
}

describe('toIcsCalendar', () => {
  it('writes a zoned event as local time with a TZID, never converted to UTC', () => {
    const out = lines(toIcsCalendar([event()], { now: NOW }));

    expect(out).toContain('DTSTART;TZID=Asia/Tbilisi:20260914T193000');
    expect(out).toContain('DTEND;TZID=Asia/Tbilisi:20260914T203000');
    // 19:30 in Tbilisi is 15:30Z; if that appears, the offset was baked in.
    expect(out.join('\n')).not.toContain('20260914T153000Z');
  });

  it('writes an unzoned event as a floating time', () => {
    const out = lines(toIcsCalendar([event({ timeZone: undefined })], { now: NOW }));

    expect(out).toContain('DTSTART:20260914T193000');
    expect(out.some((line) => line.includes('TZID'))).toBe(false);
  });

  it('writes an all-day booking as a DATE range', () => {
    const out = lines(
      toIcsCalendar(
        [
          event({
            uid: 'booking_1@ai-travel',
            title: 'Rooms Hotel Tbilisi',
            start: '2026-09-14',
            end: '2026-09-19',
            allDay: true,
          }),
        ],
        { now: NOW },
      ),
    );

    expect(out).toContain('DTSTART;VALUE=DATE:20260914');
    expect(out).toContain('DTEND;VALUE=DATE:20260919');
  });

  it('ends every line with CRLF, including the last', () => {
    const ics = toIcsCalendar([event()], { now: NOW });

    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.includes('\n\r')).toBe(false);
  });

  it('escapes the characters the format reserves', () => {
    const out = toIcsCalendar(
      [event({ title: 'Wine; cheese, and a note\nover two lines', description: 'a\\b' })],
      { now: NOW },
    );

    expect(out).toContain('SUMMARY:Wine\\; cheese\\, and a note\\nover two lines');
    expect(out).toContain('DESCRIPTION:a\\\\b');
  });

  it('carries the calendar name when given one', () => {
    expect(toIcsCalendar([], { name: 'Tbilisi & the Georgian Mountains', now: NOW })).toContain(
      'X-WR-CALNAME:Tbilisi & the Georgian Mountains',
    );
  });

  it('stamps in UTC', () => {
    expect(toIcsCalendar([event()], { now: NOW })).toContain('DTSTAMP:20260902T130000Z');
  });

  it('omits DESCRIPTION and LOCATION rather than writing empty ones', () => {
    const out = lines(toIcsCalendar([event({ description: '', location: '' })], { now: NOW }));

    expect(out.some((line) => line.startsWith('DESCRIPTION'))).toBe(false);
    expect(out.some((line) => line.startsWith('LOCATION'))).toBe(false);
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Khinkali')).toBe('SUMMARY:Khinkali');
  });

  it('folds a long line with a leading space on the continuation', () => {
    const folded = foldLine(`SUMMARY:${'a'.repeat(200)}`);
    const parts = folded.split('\r\n');

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(
      `SUMMARY:${'a'.repeat(200)}`,
    );
  });

  it('never splits a multi-byte character', () => {
    // Cyrillic is two octets each, so a fold counted in UTF-16 units would land
    // mid-character and the file would import as mojibake.
    const folded = foldLine(`SUMMARY:${'Мцхета '.repeat(20)}`);

    for (const part of folded.split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(76);
      expect(part).not.toContain('�');
    }

    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'Мцхета '.repeat(20)}`);
  });
});

describe('toGoogleCalendarUrl', () => {
  it('carries the times and the zone', () => {
    const url = new URL(toGoogleCalendarUrl(event()));

    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Khinkali');
    expect(url.searchParams.get('dates')).toBe('20260914T193000/20260914T203000');
    expect(url.searchParams.get('ctz')).toBe('Asia/Tbilisi');
  });

  it('leaves the zone off an all-day entry, where it means nothing', () => {
    const url = new URL(
      toGoogleCalendarUrl(event({ start: '2026-09-14', end: '2026-09-19', allDay: true })),
    );

    expect(url.searchParams.get('dates')).toBe('20260914/20260919');
    expect(url.searchParams.get('ctz')).toBeNull();
  });
});
