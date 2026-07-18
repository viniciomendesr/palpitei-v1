'use client';


import { useI18n } from '@/lib/i18n';
import { fw } from '@/lib/tokens';

export const MIN_NICK = 3;
export const MAX_NICK = 20;

export function isNicknameValid(draft: string): boolean {
  return draft.trim().length >= MIN_NICK;
}

export function NicknameInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  const { t } = useI18n();
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={MAX_NICK}
      placeholder={t.namePlaceholder}
      aria-label={t.editNameHdr}
      style={{
        boxSizing: 'border-box',
        width: '100%',
        marginTop: 12,
        height: 46,
        padding: '0 14px',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surface-sunken)',
        border: `1.5px solid ${invalid ? 'var(--border-2)' : 'var(--lime-line)'}`,
        color: 'var(--text-hi)',
        fontFamily: 'var(--font-sans)',
        fontSize: 15,
        fontWeight: fw.bold,
        outline: 'none',
      }}
    />
  );
}
