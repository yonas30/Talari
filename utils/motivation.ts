import { UserOrigin } from '../types';

const dashboardQuotes = [
  'Small financial choices today create more freedom tomorrow.',
  'A clear plan turns every saved amount into forward motion.',
  'Progress is built by consistency, not by perfection.',
  'Your money should support the life you are intentionally building.',
  'Every transaction is useful information for your next decision.',
  'Spend with purpose, save with patience, and keep moving forward.',
  'Financial confidence grows when you keep showing up.',
  'One thoughtful choice can change the direction of your whole month.',
];

// Surface the user's own words most days, falling back to a generic line otherwise.
export function getDashboardMessage(origin: UserOrigin | null, totalSavings: number): string {
  const personalLines = [origin?.whyBuilding, origin?.storyText].filter(
    (line): line is string => Boolean(line && line.trim().length > 0),
  );
  const sixHourSlot = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  const quotePool = totalSavings > 0 ? dashboardQuotes : [...dashboardQuotes, ...personalLines];

  return quotePool[sixHourSlot % quotePool.length];
}
