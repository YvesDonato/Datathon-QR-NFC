import { describe, expect, it } from 'vitest';
import { bucketLabel, dietaryBreakdown, doorClosedWarning } from '@/lib/domain/dashboard';

const startsAt = '2026-10-03T13:00:00Z';
const endsAt = '2026-10-03T23:00:00Z';
const at = (iso: string) => new Date(iso);

describe('dashboard rules (SPEC §11, §13)', () => {
  it('T-ADM-06: warns when within 30 min of starts_at and the door is closed, until the event ends', () => {
    expect(doorClosedWarning({ now: at('2026-10-03T12:40:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:30:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:29:00Z'), startsAt, endsAt, doorOpen: false })).toBe(false);
    expect(doorClosedWarning({ now: at('2026-10-03T14:00:00Z'), startsAt, endsAt, doorOpen: false })).toBe(true);
    expect(doorClosedWarning({ now: at('2026-10-03T12:40:00Z'), startsAt, endsAt, doorOpen: true })).toBe(false);
    expect(doorClosedWarning({ now: at('2026-10-03T23:00:00Z'), startsAt, endsAt, doorOpen: false })).toBe(false);
  });

  it('T-ANA-03: 01:00–02:00 on 2026-11-01 in Toronto gets two distinct labels (EDT, then EST)', () => {
    expect(bucketLabel('2026-11-01T05:00:00Z', 'America/Toronto')).toBe('1:00 AM EDT');
    expect(bucketLabel('2026-11-01T06:00:00Z', 'America/Toronto')).toBe('1:00 AM EST');
    expect(bucketLabel('2026-11-01T05:15:00Z', 'America/Toronto')).toBe('1:15 AM EDT');
  });
});

it('T-ADM-06: arrival labels distinguish local dates and preserve DST offsets in ranges', async () => {
  const { arrivalLabels } = await import('@/lib/domain/dashboard');
  const labels = arrivalLabels(['2026-11-08T02:15:00Z', '2026-11-09T00:30:00Z'], 'America/Toronto');
  expect(labels.map(l => l.axis)).toEqual(['Sat 9:15 PM', 'Sun 7:30 PM']);
  expect(labels[1]?.detail).toContain('Sun 7:30');
  expect(labels[1]?.detail).toContain('7:45 PM EST');
  const dst = arrivalLabels(['2026-11-01T05:45:00Z'], 'America/Toronto');
  expect(dst[0]?.detail).toContain('1:45 AM EDT');
  expect(dst[0]?.detail).toContain('1:00 AM EST');
});

it('T-ANA-07: dietary notes are grouped by keyword; a note can be in several groups; blank and "none" mean no restriction', () => {
  const notes = ['Vegetarian', 'VEGAN', 'Halal, no pork', 'Gluten free / celiac', 'lactose intolerant', 'Peanuts!', 'Végétarian', 'veg',
    'N/A', 'None.', '', null, 'Non-vegetarian', 'No dietary restrictions', 'low FODMAP'];
  expect(dietaryBreakdown(notes)).toEqual({
    total: 15,
    none: 6, // N/A, None., '', null, Non-vegetarian, No dietary restrictions
    other: 1, // low FODMAP
    groups: [
      { label: 'Vegetarian', count: 3 },
      { label: 'Dairy-free', count: 1 },
      { label: 'Gluten-free', count: 1 },
      { label: 'Halal', count: 1 },
      { label: 'No pork', count: 1 },
      { label: 'Nuts', count: 1 },
      { label: 'Vegan', count: 1 },
    ],
  });
  expect(dietaryBreakdown([])).toEqual({ total: 0, none: 0, other: 0, groups: [] });
});
