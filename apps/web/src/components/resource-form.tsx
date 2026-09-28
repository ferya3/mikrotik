'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { camelToKebab } from '@/lib/utils';

export interface FieldSpec {
  /** DTO field name (camelCase). The matching RouterOS row key is its kebab-case form. */
  name: string;
  label: string;
  type?: 'text' | 'password' | 'number' | 'select' | 'checkbox';
  options?: string[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  /** Only shown when creating (e.g. placeBefore). */
  createOnly?: boolean;
  /** Only shown when another field has one of these values. */
  showIf?: { field: string; in: string[] };
}

type Values = Record<string, string | boolean>;

function initialValues(fields: FieldSpec[], row?: Record<string, string>): Values {
  const v: Values = {};
  for (const f of fields) {
    const raw = row?.[camelToKebab(f.name)];
    if (f.type === 'checkbox') v[f.name] = raw === 'true' || raw === 'yes';
    else v[f.name] = raw ?? '';
  }
  return v;
}

/** Builds the request body: typed values, empty fields omitted, and on edit only the fields that changed. */
function toBody(fields: FieldSpec[], values: Values, initial: Values, isEdit: boolean) {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    if (isEdit && f.createOnly) continue;
    const v = values[f.name];
    if (isEdit && v === initial[f.name]) continue;
    if (f.type === 'checkbox') body[f.name] = Boolean(v);
    else if (v === '' || v === undefined) {
      // Cleared on edit → null, which the API turns into a RouterOS `unset`.
      if (isEdit) body[f.name] = null;
    } else if (f.type === 'number') body[f.name] = Number(v);
    else body[f.name] = v;
  }
  return body;
}

export function ResourceForm({
  fields,
  row,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  fields: FieldSpec[];
  row?: Record<string, string>;
  submitLabel: string;
  onSubmit: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const isEdit = !!row;
  const [initial] = useState(() => initialValues(fields, row));
  const [values, setValues] = useState<Values>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = fields.filter(
    (f) => !(isEdit && f.createOnly) && (!f.showIf || f.showIf.in.includes(String(values[f.showIf.field] ?? ''))),
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const shown = new Set(visible.map((f) => f.name));
      await onSubmit(toBody(fields.filter((f) => shown.has(f.name)), values, initial, isEdit));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible.map((f) => (
          <div key={f.name} className={f.type === 'checkbox' ? 'flex items-center gap-2 pt-5' : 'space-y-1.5'}>
            {f.type === 'checkbox' ? (
              <>
                <input
                  id={f.name}
                  type="checkbox"
                  className="size-4 accent-[hsl(var(--primary))]"
                  checked={Boolean(values[f.name])}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
                />
                <Label htmlFor={f.name}>{f.label}</Label>
              </>
            ) : (
              <>
                <Label htmlFor={f.name}>
                  {f.label}
                  {f.required && !isEdit && <span className="text-destructive"> *</span>}
                </Label>
                {f.type === 'select' ? (
                  <Select
                    id={f.name}
                    value={String(values[f.name] ?? '')}
                    required={f.required && !isEdit}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  >
                    <option value="">—</option>
                    {f.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={f.name}
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    required={f.required && !isEdit}
                    value={String(values[f.name] ?? '')}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                )}
                {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
              </>
            )}
          </div>
        ))}
      </div>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
