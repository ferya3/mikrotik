import { createTwoFilesPatch } from 'diff';

/**
 * `/export` starts with a timestamp comment ("# 2026-09-28 12:00:00 by RouterOS 7.16")
 * that changes on every export; strip volatile header comments so diffs show real changes only.
 */
export function normalizeExport(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^# (\w{3}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2} by RouterOS/.test(line))
    .join('\n')
    .trimEnd();
}

export function configDiff(fromLabel: string, from: string, toLabel: string, to: string): string {
  return createTwoFilesPatch(fromLabel, toLabel, normalizeExport(from) + '\n', normalizeExport(to) + '\n', '', '', {
    context: 3,
  });
}
