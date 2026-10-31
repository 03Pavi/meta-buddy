import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Text } from './AppText';
import { radius, spacing, usePalette, type Palette } from './theme';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: Tone;
}) {
  const palette = usePalette();
  const colors = toneColors(palette, tone);
  return (
    <View
      style={[styles.pill, { backgroundColor: colors.background }]}
      accessibilityRole="text"
    >
      <Text style={[styles.pillText, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

function toneColors(
  palette: Palette,
  tone: Tone,
): { background: string; text: string } {
  switch (tone) {
    case 'success':
      return { background: palette.neutralSurface, text: palette.success };
    case 'warning':
      return { background: palette.neutralSurface, text: palette.warning };
    case 'danger':
      return { background: palette.dangerSurface, text: palette.danger };
    case 'accent':
      return { background: palette.neutralSurface, text: palette.accent };
    default:
      return { background: palette.neutralSurface, text: palette.mutedText };
  }
}

export function Card({
  title,
  children,
  style,
}: {
  title?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
        style,
      ]}
    >
      {title ? (
        <Text style={[styles.cardTitle, { color: palette.mutedText }]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function KeyValueRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  const palette = usePalette();
  const colors = toneColors(palette, tone ?? 'neutral');
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: palette.mutedText }]}>
        {label}
      </Text>
      <Text
        style={[styles.rowValue, { color: tone ? colors.text : palette.text }]}
      >
        {value}
      </Text>
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  disabled,
  loading,
  variant = 'secondary',
  accessibilityHint,
}: ButtonProps) {
  const palette = usePalette();
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const background = isPrimary
    ? palette.accent
    : isDanger
    ? palette.dangerSurface
    : palette.surface;
  const foreground = isPrimary
    ? palette.accentText
    : isDanger
    ? palette.danger
    : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled: !!disabled || !!loading,
        busy: !!loading,
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: isPrimary ? palette.accent : palette.border,
        },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Notice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.notice,
        { backgroundColor: palette.dangerSurface, borderColor: palette.danger },
      ]}
      accessibilityRole="alert"
    >
      <Text style={[styles.noticeText, { color: palette.danger }]}>
        {message}
      </Text>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
        >
          <Text style={[styles.dismiss, { color: palette.danger }]}>
            Dismiss
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowLabel: { fontSize: 15, flexShrink: 1 },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1, fontSize: 14 },
  dismiss: { fontSize: 14, fontWeight: '600' },
});
