import { parseBeverageLabel, type ParsedLabel } from '@threshold/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Chip, Screen } from '../components/ui';
import type { DrinkDraft } from '../features/session/drinkInput';
import { describeServing } from '../lib/format';
import { ThresholdVisionNative } from '../modules/threshold-vision';
import { useDraftStore } from '../stores/draftStore';
import { colors, radii, spacing } from '../theme';

/**
 * Label scanning: photo → on-device OCR (Apple Vision) → candidate fields → user confirmation.
 * Extracted values are never logged without the user reviewing them in the logging sheet.
 */
export default function ScanLabel() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [parsed, setParsed] = useState<ParsedLabel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ThresholdVisionNative) {
    return (
      <Screen edges={['top', 'bottom']}>
        <AppText variant="title2">Label scanning unavailable</AppText>
        <AppText color={colors.textSecondary}>This build doesn’t include on-device text recognition. You can enter the drink manually.</AppText>
        <Button label="Close" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (!permission?.granted) {
    return (
      <Screen edges={['top', 'bottom']}>
        <AppText variant="title2">Camera access</AppText>
        <AppText color={colors.textSecondary}>
          Threshold uses the camera only while you scan a label. The photo is processed on your device and deleted immediately.
        </AppText>
        <Button label="Allow camera" onPress={() => void requestPermission()} />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  const capture = async () => {
    if (!camera.current || !ThresholdVisionNative) return;
    setBusy(true);
    setError(null);
    let uri: string | null = null;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.8, exif: false });
      uri = photo.uri;
      const lines = await ThresholdVisionNative.recognizeText(photo.uri);
      const result = parseBeverageLabel(lines.filter((l) => l.confidence >= 0.3).map((l) => l.text));
      if (!result.abvPercent && !result.serving && !result.productName) setError('No label text was recognised. Try again with the label filling the frame.');
      else setParsed(result);
    } catch {
      setError('Scanning failed. Try again or enter the drink manually.');
    } finally {
      if (uri) {
        try {
          const f = new File(uri);
          if (f.exists) f.delete();
        } catch {
          // best effort; the OS also purges the cache directory
        }
      }
      setBusy(false);
    }
  };

  const useValues = () => {
    if (!parsed) return;
    const draft: DrinkDraft = {
      beverageId: null,
      templateKey: 'label_scan',
      name: parsed.productName?.value ?? 'Scanned drink',
      category: 'custom',
      serving: parsed.serving?.value ?? { value: 12, unit: 'fl_oz_us' },
      abvPercent: parsed.abvPercent?.value ?? null,
      fractionConsumed: 1,
      useTypicalRecipe: false,
      estimate: null,
      minutesAgo: 0,
    };
    useDraftStore.getState().set(draft);
    router.back();
  };

  if (parsed) {
    const row = (label: string, value: string | null, conf: string | undefined, src: string | undefined) => (
      <View style={{ gap: spacing.xxs }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText variant="headline">{label}</AppText>
          {value ? <Chip label={`${conf} confidence`} tone={conf === 'high' ? 'observed' : 'estimated'} /> : <Chip label="Not found" tone="missing" />}
        </View>
        <AppText>{value ?? 'Enter manually'}</AppText>
        {src ? (
          <AppText variant="footnote" color={colors.textTertiary}>
            Read as: “{src}”
          </AppText>
        ) : null}
      </View>
    );
    return (
      <Screen edges={['top', 'bottom']}>
        <AppText variant="title2">Check what was read</AppText>
        <AppText color={colors.textSecondary}>You’ll be able to edit everything before logging.</AppText>
        <Card>
          {row('Name', parsed.productName?.value ?? null, parsed.productName?.confidence, parsed.productName?.sourceText)}
          {row('Alcohol by volume', parsed.abvPercent ? `${parsed.abvPercent.value}%` : null, parsed.abvPercent?.confidence, parsed.abvPercent?.sourceText)}
          {row('Container size', parsed.serving ? describeServing(parsed.serving.value) : null, parsed.serving?.confidence, parsed.serving?.sourceText)}
        </Card>
        <AppText variant="footnote" color={colors.textTertiary}>
          Container size may differ from what you poured — adjust the serving on the next screen.
        </AppText>
        <Button label="Review and log" onPress={useValues} size="large" />
        <Button label="Scan again" variant="ghost" onPress={() => setParsed(null)} />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CameraView ref={camera} style={{ flex: 1 }} facing="back" accessibilityLabel="Camera preview" />
      <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxxl, gap: spacing.sm }}>
        {error ? (
          <View style={{ backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.md }}>
            <AppText color={colors.textPrimary}>{error}</AppText>
          </View>
        ) : null}
        <Button label="Capture label" onPress={capture} loading={busy} size="large" />
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      </View>
    </View>
  );
}
