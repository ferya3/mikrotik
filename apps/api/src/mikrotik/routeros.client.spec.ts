import { parseRosDuration } from './routeros.client';

describe('parseRosDuration', () => {
  it.each([
    ['1w2d03:04:05', 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5],
    ['3d4h5m6s', 3 * 86400 + 4 * 3600 + 5 * 60 + 6],
    ['00:01:02', 62],
    ['45s', 45],
    ['10m', 600],
    ['', 0],
  ])('%s → %i', (input, expected) => {
    expect(parseRosDuration(input)).toBe(expected);
  });
});
