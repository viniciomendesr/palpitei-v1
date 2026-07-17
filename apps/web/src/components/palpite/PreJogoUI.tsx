'use client';

/**
 * As peças visuais da tela de palpite pré-jogo — o que o design system não tem
 * pronto (stepper, segmentado, avatares empilhados, o card de mercado e o toast
 * local). Tudo por token, zero hex, sem emoji (ícone é SVG).
 */

import type { ReactNode } from 'react';
import { fw } from '@/lib/tokens';
import { Check, Star } from '@/components/Icons';

/** Relógio pequeno para a pill "Fecha em …". */
export function ClockIcon({ size = 13, color = 'var(--lime)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3 2" />
    </svg>
  );
}

/** Botões segmentados: 3 (resultado) ou 2 (Acima/Abaixo). Um selecionado por vez. */
export function Segmentado<T extends string>({
  options,
  value,
  onSelect,
  disabled = false,
}: {
  options: { id: T; label: string }[];
  value: T | null;
  onSelect: (id: T) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(o.id)}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              cursor: disabled ? 'default' : 'pointer',
              flex: 1,
              textAlign: 'center',
              padding: '13px 8px',
              borderRadius: 'var(--r-lg)',
              fontWeight: fw.heavy,
              fontSize: 13.5,
              transition: 'background .15s, border-color .15s',
              background: on ? 'var(--lime-a14)' : 'var(--surface-2)',
              border: `1.5px solid ${on ? 'var(--lime)' : 'var(--border-1)'}`,
              color: on ? 'var(--text-hi)' : 'var(--text-1)',
              opacity: disabled && !on ? 0.6 : 1,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function passoStyle(disabled: boolean) {
  return {
    all: 'unset',
    boxSizing: 'border-box',
    cursor: disabled ? 'default' : 'pointer',
    width: 36,
    height: 36,
    borderRadius: 11,
    background: 'var(--surface-2)',
    border: '1px solid var(--border-2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: fw.black,
    fontSize: 20,
    lineHeight: 1,
    color: 'var(--text-1)',
    opacity: disabled ? 0.6 : 1,
  } as const;
}

/** Um lado do placar exato: sigla + [− valor +]. */
export function Stepper({
  code,
  color,
  value,
  onDec,
  onInc,
  disabled = false,
}: {
  code: string;
  color: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11 }}>
      <span style={{ fontWeight: fw.black, fontStyle: 'italic', fontSize: 12, letterSpacing: -0.3, color }}>{code}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <button type="button" aria-label="menos" disabled={disabled} onClick={onDec} style={passoStyle(disabled)}>
          −
        </button>
        <span style={{ minWidth: 24, textAlign: 'center', fontWeight: fw.black, fontStyle: 'italic', fontSize: 30, letterSpacing: -1 }}>
          {value}
        </span>
        <button type="button" aria-label="mais" disabled={disabled} onClick={onInc} style={passoStyle(disabled)}>
          +
        </button>
      </div>
    </div>
  );
}

/** Avatares empilhados dos amigos (iniciais + cor). */
export function AvataresEmpilhados({ items }: { items: { label: string; color: string; ink: string }[] }) {
  return (
    <div style={{ display: 'flex', flex: 'none' }}>
      {items.map((a, i) => (
        <span
          key={a.label + i}
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: a.color,
            border: '2px solid var(--bg-app)',
            marginLeft: i === 0 ? 0 : -9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            fontWeight: fw.black,
            color: a.ink,
          }}
        >
          {a.label}
        </span>
      ))}
    </div>
  );
}

/** O card de um mercado: cabeçalho (rótulo · palpite dado · vale N XP) + sub + controle. */
export function MercadoCard({
  label,
  sub,
  worthText,
  selectedText,
  selected,
  children,
}: {
  label: string;
  sub: string;
  worthText: string;
  selectedText: string;
  selected: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        background: 'var(--surface-1)',
        border: `1px solid ${selected ? 'var(--lime-line)' : 'var(--border-1)'}`,
        borderRadius: 'var(--r-2xl)',
        padding: '16px 16px 17px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: fw.black, fontSize: 10.5, letterSpacing: 1, color: 'var(--lime)' }}>{label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
          {selected && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: fw.black, letterSpacing: 0.4, color: 'var(--lime)' }}>
              <Check size={11} width={3.2} />
              {selectedText}
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: fw.heavy, color: 'var(--gold)' }}>
            <Star size={11} />
            {worthText}
          </span>
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: fw.medium, color: 'var(--text-muted)', marginTop: 5 }}>{sub}</div>
      {children}
    </div>
  );
}

/** Toast local (a tela não tem toast global): banner que sobe e some sozinho. */
export function ToastBanner({ title, sub }: { title: string; sub: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 100,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '13px 16px',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surface-2)',
        border: '1px solid var(--lime-line)',
        boxShadow: 'var(--shadow-toast)',
        animation: 'fadeUp .3s ease both',
      }}
    >
      <span style={{ fontWeight: fw.heavy, fontSize: 13.5, color: 'var(--text-hi)' }}>{title}</span>
      {sub && <span style={{ fontSize: 12, fontWeight: fw.medium, color: 'var(--text-2)' }}>{sub}</span>}
    </div>
  );
}
