/**
 * Browser-only crash recovery for the versioned PREVIEW document.
 * Not a CAD project, exact geometry, persistent undo history or STEP file.
 * FNV detects accidental damage; it is not a cryptographic authenticity check.
 */
export const RECOVERY_FORMAT = 'intuit3d.web-preview.recovery' as const;
export const RECOVERY_VERSION = 1 as const;
export const RECOVERY_CURRENT_KEY = 'intuit3d.web-preview.recovery.v1.current';
export const RECOVERY_PREVIOUS_KEY = 'intuit3d.web-preview.recovery.v1.previous';
const MAX_PREVIEW_CHARACTERS = 1024 * 1024;

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Envelope {
  format: typeof RECOVERY_FORMAT;
  version: typeof RECOVERY_VERSION;
  savedAt: number;
  previewJson: string;
  checksum: string;
}

export type RecoveryInspection<T> =
  | { readonly kind: 'none' }
  | { readonly kind: 'available'; readonly document: T; readonly savedAt: number; readonly slot: 'current' | 'previous'; readonly warning: string | null }
  | { readonly kind: 'corrupt'; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string };

function checksum(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readEnvelope<T>(source: string, parsePreview: (previewJson: string) => T): { document: T; envelope: Envelope } {
  if (source.length > MAX_PREVIEW_CHARACTERS * 2) throw new Error('Recovery envelope too large');
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || Object.keys(value).length !== 5 ||
    value.format !== RECOVERY_FORMAT || value.version !== RECOVERY_VERSION ||
    !Number.isSafeInteger(value.savedAt) || (value.savedAt as number) < 0 ||
    typeof value.previewJson !== 'string' || value.previewJson.length > MAX_PREVIEW_CHARACTERS ||
    typeof value.checksum !== 'string' || !/^[0-9a-f]{8}$/.test(value.checksum)) {
    throw new Error('Invalid or unsupported recovery envelope');
  }
  if (checksum(value.previewJson) !== value.checksum) throw new Error('Recovery integrity mismatch');
  const document = parsePreview(value.previewJson);
  return { document, envelope: value as unknown as Envelope };
}

/** Read without mutation: no silent overwrite or automatic restoration. */
export function inspectRecovery<T>(provideStorage: () => RecoveryStorage, parsePreview: (source: string) => T): RecoveryInspection<T> {
  try {
    const storage = provideStorage();
    const current = storage.getItem(RECOVERY_CURRENT_KEY);
    const previous = storage.getItem(RECOVERY_PREVIOUS_KEY);
    if (current === null && previous === null) return { kind: 'none' };
    if (current !== null) {
      try {
        const result = readEnvelope(current, parsePreview);
        return { kind: 'available', slot: 'current', document: result.document, savedAt: result.envelope.savedAt, warning: null };
      } catch { /* Preserve bad current and try independently validated previous. */ }
    }
    if (previous !== null) {
      try {
        const result = readEnvelope(previous, parsePreview);
        return { kind: 'available', slot: 'previous', document: result.document, savedAt: result.envelope.savedAt,
          warning: 'Latest local draft is damaged or missing. Only the earlier recovery snapshot is available.' };
      } catch { /* Neither snapshot can be admitted. */ }
    }
    return { kind: 'corrupt', message: 'Local recovery data cannot be validated. It has not been loaded or overwritten.' };
  } catch {
    return { kind: 'unavailable', message: 'Browser storage is unavailable. Export a preview JSON file to retain edits.' };
  }
}

/** Caller excludes transient gestures; invalid previews are preserved as editable intent. */
export function persistRecovery<T>(
  provideStorage: () => RecoveryStorage,
  serializedPreview: string,
  parsePreview: (source: string) => T,
  savedAt: number = Date.now(),
): 'written' | 'unchanged' {
  if (!Number.isSafeInteger(savedAt) || savedAt < 0) throw new Error('Invalid recovery timestamp');
  if (serializedPreview.length > MAX_PREVIEW_CHARACTERS) throw new Error('Preview exceeds recovery capacity');
  parsePreview(serializedPreview); // Fail closed if caller forgets its validation.
  const storage = provideStorage();
  const current = storage.getItem(RECOVERY_CURRENT_KEY);
  if (current !== null) {
    try {
      const old = readEnvelope(current, parsePreview);
      if (old.envelope.previewJson === serializedPreview) return 'unchanged';
      storage.setItem(RECOVERY_PREVIOUS_KEY, current);
    } catch { /* Never promote corrupt current over a good previous. */ }
  }
  const envelope: Envelope = {
    format: RECOVERY_FORMAT, version: RECOVERY_VERSION, savedAt,
    previewJson: serializedPreview, checksum: checksum(serializedPreview),
  };
  storage.setItem(RECOVERY_CURRENT_KEY, JSON.stringify(envelope));
  return 'written';
}

/** Only the user's explicit discard choice removes recoverable snapshots. */
export function discardRecovery(provideStorage: () => RecoveryStorage): void {
  const storage = provideStorage();
  storage.removeItem(RECOVERY_CURRENT_KEY);
  storage.removeItem(RECOVERY_PREVIOUS_KEY);
}
