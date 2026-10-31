import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomDock, DOCK_SPACE } from '../components/BottomDock';
import { Text } from '../components/AppText';
import { fonts, palette } from '../components/theme';
import { connectionSummary } from '../features/glasses/glassesState';
import { useChatModelReady } from '../hooks/useChatModelReady';
import { findModel } from '../services/models/catalog';
import type { RootStackParamList } from '../navigation/types';
import { useGlasses } from '../state/GlassesProvider';
import { useSettings } from '../state/SettingsProvider';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// Colors and fonts come from the app theme, so Home matches the rest of the app.
const HOME = {
  background: palette.background,
  surface: palette.surface,
  border: palette.border,
  text: palette.text,
  muted: palette.mutedText,
  accent: palette.accent,
  accentText: palette.accentText,
  warning: palette.warning,
  danger: palette.danger,
} as const;

const ORB = 150;
const TITLE_FONT = fonts.displayBold;
const LABEL_FONT = fonts.display;
const BODY_REGULAR = fonts.regular;

const GLASSES_LABEL = {
  unavailable: 'Unavailable',
  not_registered: 'Not registered',
  no_device: 'Not nearby',
  idle: 'Ready',
  connecting: 'Connecting',
  connected: 'Synced',
} as const;

/** Splits "Llama 3.2 1B (Q8_0)" into the name and the quantisation tag. */
function splitModelLabel(label: string): { name: string; quant: string | null } {
  const match = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return match ? { name: match[1], quant: match[2] } : { name: label, quant: null };
}

/** Home: a status header, the on-device model, one large orb to start talking, and two action cards. */
/** Two lenses joined by a bridge, drawn with views so no icon package is needed. */
function GlassesIcon({ color, size }: { color: string; size: number }) {
  const lens = size * 0.45;
  const lensStyle = { width: lens, height: lens, borderRadius: lens / 2, borderWidth: 2, borderColor: color };
  return (
    <View style={{ width: size, height: lens, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={lensStyle} />
      <View style={{ width: size - lens * 2, height: 2, backgroundColor: color }} />
      <View style={lensStyle} />
    </View>
  );
}

export function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { state: glasses } = useGlasses();
  const model = splitModelLabel(findModel(settings.modelId).label);
  const chatModelReady = useChatModelReady(settings.modelId);
  const connection = connectionSummary(glasses);
  const glassesSynced = connection === 'connected';

  const intro = useRef(new Animated.Value(0)).current;
  const cardsIn = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const entrance = Animated.sequence([
      Animated.timing(intro, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.stagger(
        110,
        cardsIn.map(value =>
          Animated.timing(value, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ),
      ),
    ]);
    // Two rings expand from the orb and fade, offset so they overlap.
    const ring = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const loopA = ring(ringA, 0);
    const loopB = ring(ringB, 1100);
    entrance.start();
    loopA.start();
    loopB.start();
    return () => {
      entrance.stop();
      loopA.stop();
      loopB.stop();
    };
  }, [intro, cardsIn, ringA, ringB]);

  const ringStyle = (value: Animated.Value) => ({
    opacity: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 0.18, 0] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }) }],
  });

  const rise = (value: Animated.Value) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  });

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: HOME.background, paddingTop: insets.top + 12, paddingBottom: DOCK_SPACE + insets.bottom },
      ]}
    >
      <Animated.View style={[styles.header, rise(intro)]}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Yo, I'm Buddy</Text>
            <View style={styles.bolt} />
          </View>
          <Text style={styles.subtitle}>On-device brain • Zero cloud snitching</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('Glasses')}
          accessibilityRole="button"
          accessibilityLabel={`Glasses ${GLASSES_LABEL[connection]}`}
          style={styles.glassesPill}
        >
          <GlassesIcon color={HOME.text} size={22} />
          <View style={[styles.statusDot, { backgroundColor: glassesSynced ? HOME.accent : HOME.warning }]} />
        </Pressable>
      </Animated.View>

      <Animated.View style={rise(intro)}>
        <Pressable
          onPress={() => navigation.navigate('Models')}
          accessibilityRole="button"
          accessibilityLabel="Change model"
          style={styles.modelPill}
        >
          <View style={styles.modelDot} />
          {chatModelReady === false ? (
            <Text style={styles.modelName} numberOfLines={1}>
              Choose model
            </Text>
          ) : (
            <>
              <Text style={styles.modelName} numberOfLines={1}>
                {model.name}
              </Text>
              {model.quant ? (
                <View style={styles.quantChip}>
                  <Text style={styles.quantText}>{model.quant}</Text>
                </View>
              ) : null}
              <View style={styles.edgeChip}>
                <Text style={styles.edgeText}>EDGE</Text>
              </View>
            </>
          )}
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </Animated.View>

      <View style={styles.orbArea}>
        <Pressable
          onPress={() => navigation.navigate('Assistant')}
          accessibilityRole="button"
          accessibilityLabel="Tap to talk"
          style={styles.orbPressable}
        >
          <Animated.View style={[styles.ring, ringStyle(ringA)]} />
          <Animated.View style={[styles.ring, ringStyle(ringB)]} />
          <View style={styles.orb}>
            <View style={styles.mic}>
              <View style={styles.micBody} />
              <View style={styles.micStem} />
            </View>
            <Text style={styles.orbLabel}>TAP TO TALK</Text>
          </View>
        </Pressable>
        <Text style={styles.orbCaption}>Ready to talk • Tap the orb to start</Text>
      </View>

      <View style={styles.cards}>
        <Animated.View style={rise(cardsIn[0])}>
          <Pressable
            onPress={() => navigation.navigate('Assistant')}
            accessibilityRole="button"
            accessibilityLabel="Chat with Buddy"
            style={styles.card}
          >
            <View style={styles.cardIcon}>
              <View style={styles.speechBubble} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Chat</Text>
              <Text style={styles.cardHint}>Type or speak a question</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Animated.View>

        <Animated.View style={rise(cardsIn[1])}>
          <Pressable
            onPress={() => navigation.navigate('Glasses')}
            accessibilityRole="button"
            accessibilityLabel="Ray-Ban Meta glasses"
            style={styles.card}
          >
            <View style={styles.cardIcon}>
              <GlassesIcon color={HOME.text} size={28} />
            </View>
            <View style={styles.cardText}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle}>Ray-Ban Meta Glasses</Text>
                <View style={[styles.badge, { borderColor: glassesSynced ? HOME.accent : HOME.warning }]}>
                  <Text style={[styles.badgeText, { color: glassesSynced ? HOME.accent : HOME.warning }]}>
                    {GLASSES_LABEL[connection].toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardHint}>Camera and voice through your glasses</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Animated.View>
      </View>

      <BottomDock active="Home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontFamily: TITLE_FONT, fontSize: 26, color: HOME.text },
  bolt: { width: 8, height: 14, backgroundColor: HOME.accent, transform: [{ skewX: '-12deg' }], borderRadius: 2 },
  subtitle: { fontFamily: BODY_REGULAR, fontSize: 13, color: HOME.muted },
  glassesPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
    backgroundColor: HOME.surface,
    borderWidth: 1,
    borderColor: HOME.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  modelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingLeft: 12,
    paddingRight: 10,
    height: 38,
    borderRadius: 19,
    backgroundColor: HOME.surface,
    borderWidth: 1,
    borderColor: HOME.border,
  },
  modelDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HOME.accent },
  modelName: { fontFamily: LABEL_FONT, fontSize: 13, color: HOME.text, flexShrink: 1 },
  quantChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: HOME.border },
  quantText: { fontFamily: BODY_REGULAR, fontSize: 11, color: HOME.muted },
  edgeChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: HOME.accent },
  edgeText: { fontFamily: TITLE_FONT, fontSize: 10, color: HOME.accentText, letterSpacing: 0.5 },
  chevron: { fontFamily: TITLE_FONT, fontSize: 22, color: HOME.muted },
  orbArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  orbPressable: { width: ORB * 1.9, height: ORB * 1.9, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    borderWidth: 1.5,
    borderColor: HOME.accent,
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: HOME.surface,
    borderWidth: 2,
    borderColor: HOME.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  mic: { alignItems: 'center' },
  micBody: { width: 18, height: 28, borderRadius: 9, borderWidth: 2.5, borderColor: HOME.accent },
  micStem: { width: 2.5, height: 9, backgroundColor: HOME.accent, marginTop: 2 },
  orbLabel: { fontFamily: TITLE_FONT, fontSize: 11, color: HOME.accent, letterSpacing: 1 },
  orbCaption: { fontFamily: BODY_REGULAR, fontSize: 13, color: HOME.muted },
  cards: { gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: HOME.surface,
    borderWidth: 1,
    borderColor: HOME.border,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1C2128',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speechBubble: { width: 18, height: 14, borderRadius: 5, borderWidth: 2, borderColor: HOME.accent },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: TITLE_FONT, fontSize: 16, color: HOME.text },
  cardHint: { fontFamily: BODY_REGULAR, fontSize: 13, color: HOME.muted },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  badgeText: { fontFamily: TITLE_FONT, fontSize: 10, letterSpacing: 0.5 },
});
