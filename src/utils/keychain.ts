// Integrations whose secret lives in the macOS Keychain, not in Roo's settings.
// Stripe: the integration names a business (its `projectId`, an org entity id) and Roo
// reads that business's key from the Keychain (stripe-action:<business>, else the read-only
// Money key stripe:<business>). Set keys with ~/portfolio/bin/roo-keys-setup.sh.
// Resend: sending lives in the Outbox ("Email via Resend"); the old Resend widget is retired.

export const KEYCHAIN_SETUP = '~/portfolio/bin/roo-keys-setup.sh';

export const usesKeychain = (type: string): boolean => type === 'stripe';

// Retired integrations: not offered when adding a project or widget.
export const RETIRED_INTEGRATIONS = new Set<string>(['resend']);

// What makes an integration "connected": a business id for Keychain ones, a key for the rest.
export function hasCredential(type: string, c: { apiKey?: string; projectId?: string } | null | undefined): boolean {
  if (!c) return false;
  return usesKeychain(type) ? !!c.projectId?.trim() : !!c.apiKey;
}

// Never persist a plaintext key for a Keychain integration (Rust drops it too).
export function withoutKeychainSecret<T extends { type: string; apiKey?: string }>(i: T): T {
  if (!usesKeychain(i.type)) return i;
  const { apiKey: _drop, ...rest } = i;
  return rest as T;
}
