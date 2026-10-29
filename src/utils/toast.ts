import { useSyncExternalStore } from 'react';

// One short message at a time along the bottom of the window (the demo's stand-in for actions).
export interface ToastMessage {
  id: number;
  text: string;
}

let current: ToastMessage | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const SHOW_MS = 4500;

function emit() {
  listeners.forEach((l) => l());
}

export function showToast(text: string) {
  current = { id: Date.now(), text };
  if (timer) clearTimeout(timer);
  timer = setTimeout(dismissToast, SHOW_MS);
  emit();
}

export function dismissToast() {
  current = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useToast(): ToastMessage | null {
  return useSyncExternalStore(subscribe, () => current);
}
