import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Writes an export to the app's cache directory (excluded from backups, cleared by the OS) and
 * opens the share sheet so the user decides where it goes. The temporary file is removed after.
 */
export async function shareTextFile(name: string, content: string, mimeType: 'application/json' | 'text/csv'): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  await file.write(content);
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: 'Export Threshold data', UTI: mimeType === 'application/json' ? 'public.json' : 'public.comma-separated-values-text' });
  } finally {
    if (file.exists) file.delete();
  }
}
