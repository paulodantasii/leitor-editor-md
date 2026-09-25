export type HighlightColor = 'yellow' | 'blue' | 'red' | 'pink' | 'green' | 'purple' | 'orange' | 'gray';

export interface HighlightColorOption {
  id: HighlightColor;
  name: string;
  bgClass: string;
  borderClass: string;
  hex: string;
}

export type FontFamily = 'sans' | 'serif';
export type TextWidth = 'narrow' | 'normal' | 'wide' | 'full'; // 65ch, 80ch, 100ch, 100%

export interface UserPreferences {
  theme: 'light' | 'dark';
  fontSize: number; // 14 to 24 px
  fontFamily: FontFamily;
  textWidth: TextWidth;
}

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'offline-pending' | 'error';

export interface DocumentState {
  title: string;
  content: string;
  oneDriveItemId: string | null;
  lastSavedAt: string | null;
  isDirty: boolean;
  docId?: string;
  cloudLastModified?: string | null;
}

export interface OneDriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount: number };
  file?: { mimeType: string };
  lastModifiedDateTime: string;
  eTag?: string;
  parentReference?: { path?: string };
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface RecentDocumentItem {
  id: string;
  title: string;
  content: string;
  oneDriveItemId: string | null;
  lastSavedAt: string | null;
  lastOpenedAt: number;
  isOneDrive: boolean;
  cloudLastModified?: string | null;
}
