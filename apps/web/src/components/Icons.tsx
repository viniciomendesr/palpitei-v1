'use client';

import { useId } from 'react';

interface IconProps {
  size?: number;
  color?: string;
}

export function ChevronRight({ size = 18, color = 'var(--text-faint)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronLeft({ size = 17, color = 'var(--text-1)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronDown({ size = 17, color = 'var(--text-1)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function Check({ size = 17, color = 'var(--lime)', width = 2.8 }: IconProps & { width?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 12.5l5 5L20 6" />
    </svg>
  );
}

export function Close({ size = 20, color = 'var(--red)', width = 2.8 }: IconProps & { width?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function Star({ size = 13, color = 'var(--gold)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M12 2l2.4 3.9 4.5 1-3 3.5.5 4.6L12 17l-4.4 2 .5-4.6-3-3.5 4.5-1L12 2z" />
    </svg>
  );
}

export function Crown({ size = 20, color = 'var(--on-lime)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M5 16l-2-9 6 4 3-7 3 7 6-4-2 9H5zm0 3h14v2H5v-2z" />
    </svg>
  );
}

export function Ball({ size = 15, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.2" />
      <path d="M12 7.1l4.05 2.94-1.55 4.76H9.5L7.95 10.04 12 7.1z" fill={color} stroke="none" />
      <path d="M12 2.8v4.3M4.2 9.1l3.75 0.94M6.6 18.3l2.9-3.5M17.4 18.3l-2.9-3.5M19.8 9.1l-3.75 0.94" />
    </svg>
  );
}

export function Triangle({ size = 17, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      style={{ flex: 'none', marginTop: 1 }}
      aria-hidden="true"
    >
      <path d="M12 3l10 18H2L12 3z" />
    </svg>
  );
}

export function Layers({ size = 11, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={(size * 9) / 11} viewBox="0 0 24 20" aria-hidden="true">
      <path fill={color} d="M5 14h14l-3 4H2l3-4zM5 1h14l-3 4H2l3-4zM19 7H5l-3 4h14l3-4z" />
    </svg>
  );
}

export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export function PrivyMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Privy">
      <rect width="32" height="32" rx="8" fill="#100E0C" />
      <path
        d="M11 9h6.4c2.9 0 4.9 1.9 4.9 4.7 0 2.8-2 4.7-4.9 4.7H14v4.6h-3V9zm3 2.7v4h3.1c1.3 0 2.2-.8 2.2-2s-.9-2-2.2-2H14z"
        fill="#fff"
      />
    </svg>
  );
}

export function SolanaMark({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={(size * 20) / 24} viewBox="0 0 24 20" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="2" y1="18" x2="22" y2="2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9945FF" />
          <stop offset="1" stopColor="#19FB9B" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M5.2 14.4a.8.8 0 0 1 .57-.24H23a.4.4 0 0 1 .29.68l-3.5 3.52a.8.8 0 0 1-.57.24H1.98a.4.4 0 0 1-.29-.68l3.5-3.52zM5.2 1.4a.83.83 0 0 1 .57-.24H23a.4.4 0 0 1 .29.68l-3.5 3.52a.8.8 0 0 1-.57.24H1.98a.4.4 0 0 1-.29-.68L5.2 1.4zM19.79 7.86a.8.8 0 0 0-.57-.24H1.98a.4.4 0 0 0-.29.68l3.5 3.52a.8.8 0 0 0 .57.24H23a.4.4 0 0 0 .29-.68l-3.5-3.52z"
      />
    </svg>
  );
}

export function PlayCircle({ size = 21, color = 'var(--lime)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.7} />
      <path d="M10 8.5v7l6-3.5-6-3.5z" fill={color} />
    </svg>
  );
}

export function HomeIcon({ size = 23 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function RankingIcon({ size = 23 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 20V10M12 20V4M18 20v-6" />
    </svg>
  );
}

export function ProfileIcon({ size = 23 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

export function Pencil({ size = 14, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function Copy({ size = 18, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function Lock({ size = 12, color = 'var(--text-muted)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function CardIcon({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--text-1)"
      strokeWidth={2}
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

export function PixIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--lime)" aria-hidden="true">
      <path d="M12 2l4 4-4 4-4-4 4-4zm-6 6l4 4-4 4-4-4 4-4zm12 0l4 4-4 4-4-4 4-4zm-6 6l4 4-4 4-4-4 4-4z" />
    </svg>
  );
}

/** Bottom-nav glyph for the marketplace: a storefront awning over a counter. */
export function StoreIcon({ size = 23 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 4h17l1 5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0l1-5z" />
      <path d="M5 11.5V20h14v-8.5" />
    </svg>
  );
}

export function Info({ size = 16, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </svg>
  );
}

export function Trophy({ size = 20, color = 'var(--gold)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z" />
      <path d="M17 5h2.5a1.5 1.5 0 0 1 0 3H17M7 5H4.5a1.5 1.5 0 0 0 0 3H7" />
      <path d="M12 13v3" />
      <path d="M10 16h4l.4 4H9.6z" />
    </svg>
  );
}

export function Bolt({ size = 18, color = 'var(--lime)' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
    </svg>
  );
}

/** On-chain verification seal: a shield with a check. */
export function ShieldCheck({ size = 14, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 7-7 9-4-2-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function Unlock({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 7.5-1.9" />
    </svg>
  );
}

export function Ticket({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.7a2 2 0 0 0 0 3.6v1.7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.7a2 2 0 0 0 0-3.6V8.5z" />
      <path d="M14 6.5v11" />
    </svg>
  );
}

export function Tag({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12.5l-7.5 7.5a2 2 0 0 1-2.8 0l-6-6a2 2 0 0 1-.6-1.6l.5-6.3a2 2 0 0 1 1.8-1.8l6.3-.5a2 2 0 0 1 1.6.6l6.7 6.7a2 2 0 0 1 0 1.4z" />
      <circle cx="8.5" cy="8.5" r="1.4" />
    </svg>
  );
}

export function Shirt({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3l3 2 3-2 5.5 3-2 4-2-1v11H7.5V9l-2 1-2-4L9 3z" />
    </svg>
  );
}

export function Shield({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7.5 3v5.5c0 4.7-3.2 7.5-7.5 9.5-4.3-2-7.5-4.8-7.5-9.5V6z" />
    </svg>
  );
}

export function Frame({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.5 17.5c1-2.2 2.6-3.2 4.5-3.2s3.5 1 4.5 3.2" />
    </svg>
  );
}

export function Drop({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5l5 6.4a6.2 6.2 0 1 1-10 0l5-6.4z" />
    </svg>
  );
}

export function Users({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3.2 2.7-5 6-5s6 1.8 6 5" />
      <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6M17.5 14.9c2.1.5 3.5 2 3.5 4.6" />
    </svg>
  );
}

export function Flag({ size = 20, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 21V4" />
      <path d="M6 5h11l-2 3.5L17 12H6z" />
    </svg>
  );
}

/** Proof-of-Call seal: a stamped ribbon medal. */
export function Seal({ size = 20, color = 'var(--gold)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="9.5" r="6" />
      <path d="M9.6 9.4l1.7 1.7 3.2-3.3" />
      <path d="M8.6 14.8L7 21l5-2.2L17 21l-1.6-6.2" />
    </svg>
  );
}

export function WalletIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 15) / 19} viewBox="0 0 24 20" aria-hidden="true">
      <path fill="#19FB9B" d="M5 14h16l-3 4H2l3-4zM5 2h16l-3 4H2l3-4zM19 8H3l3 4h16l-3-4z" />
    </svg>
  );
}

export function ArrowRight({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function Broadcast({ size = 26, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="2.3" fill={color} stroke="none" />
      <path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M6.1 6.1a8.3 8.3 0 0 0 0 11.8M17.9 6.1a8.3 8.3 0 0 1 0 11.8" />
    </svg>
  );
}

export function Replay({ size = 25, color = 'var(--lime)' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.2 9.2A9 9 0 1 1 3 13" />
      <path d="M3 4.4V9.2h4.8" />
      <path d="M10.4 9.2v5.6l4.6-2.8-4.6-2.8z" fill={color} stroke="none" />
    </svg>
  );
}
