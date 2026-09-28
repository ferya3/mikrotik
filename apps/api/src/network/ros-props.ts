import type { RosProps } from '../mikrotik/types';

export const camelToKebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * Converts a validated DTO into RouterOS properties.
 * Only own, defined fields are emitted — the DTO whitelist is the property whitelist.
 */
export function toRosProps(dto: object): RosProps {
  const out: RosProps = {};
  for (const [key, value] of Object.entries(dto)) {
    if (value === undefined || value === null) continue;
    const k = camelToKebab(key);
    if (typeof value === 'boolean') out[k] = value ? 'yes' : 'no';
    else if (typeof value === 'number') out[k] = String(value);
    else if (Array.isArray(value)) out[k] = value.join(',');
    else if (typeof value === 'string') out[k] = value;
    else throw new Error(`Unsupported value for ${key}`);
  }
  return out;
}
