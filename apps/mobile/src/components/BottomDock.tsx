import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/types';
import { Text } from './AppText';
import { radius, spacing, usePalette } from './theme';

export type DockTab = 'Home' | 'Models' | 'Settings';

const TABS: Array<{ name: DockTab; label: string }> = [
  { name: 'Home', label: 'Home' },
  { name: 'Models', label: 'Models' },
  { name: 'Settings', label: 'Settings' },
];

const DOCK_MARGIN = spacing.lg;
const DOCK_PADDING = 6;
const DOCK_HEIGHT = 60;
/** How long the highlight takes to reach the tapped tab before the screen changes. */
const SLIDE_MS = 260;

/** Space a screen should leave at its bottom so content is not hidden behind the dock. */
export const DOCK_SPACE = DOCK_HEIGHT + spacing.lg * 2;

/**
 * The bottom dock shown on the three main screens. Tapping a tab first slides the highlight to it, then opens the
 * screen, so the movement is visible. The tapped tab also presses in and springs back.
 */
export function BottomDock({ active }: { active: DockTab }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const tabWidth = (width - DOCK_MARGIN * 2 - DOCK_PADDING * 2) / TABS.length;
  const activeIndex = TABS.findIndex(tab => tab.name === active);
  const slide = useRef(new Animated.Value(activeIndex)).current;
  const pendingRef = useRef<DockTab | null>(null);

  useEffect(() => {
    // Keeps the highlight in place when the screen first opens on this tab.
    slide.setValue(activeIndex);
  }, [activeIndex, slide]);

  const go = (tab: DockTab, index: number) => {
    if (tab === active || pendingRef.current) return;
    pendingRef.current = tab;
    Animated.timing(slide, {
      toValue: index,
      duration: SLIDE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      pendingRef.current = null;
      if (finished) navigation.navigate(tab);
    });
  };

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + spacing.md }]}>
      <View
        style={[
          styles.dock,
          { backgroundColor: palette.surface, borderColor: palette.border, marginHorizontal: DOCK_MARGIN },
        ]}
        accessibilityRole="tablist"
      >
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              width: tabWidth,
              backgroundColor: palette.neutralSurface,
              transform: [{ translateX: Animated.multiply(slide, tabWidth) }],
            },
          ]}
        />
        {TABS.map((tab, index) => (
          <DockTabItem
            key={tab.name}
            label={tab.label}
            isActive={tab.name === active}
            onPress={() => go(tab.name, index)}
          />
        ))}
      </View>
    </View>
  );
}

/** One tab: presses in when tapped, and grows slightly with a dot underneath when it is the current screen. */
function DockTabItem({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  const palette = usePalette();
  const press = useRef(new Animated.Value(1)).current;
  const emphasis = useRef(new Animated.Value(isActive ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(emphasis, {
      toValue: isActive ? 1 : 0,
      damping: 14,
      stiffness: 220,
      useNativeDriver: true,
    }).start();
  }, [isActive, emphasis]);

  const springTo = (value: number) =>
    Animated.spring(press, { toValue: value, damping: 12, stiffness: 300, useNativeDriver: true }).start();

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => springTo(0.92)}
      onPressOut={() => springTo(1)}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isActive }}
      style={styles.tab}
    >
      <Animated.View
        style={[
          styles.tabInner,
          {
            transform: [
              { scale: press },
              { scale: emphasis.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
            ],
          },
        ]}
      >
        <Text style={[styles.tabLabel, { color: isActive ? palette.accent : palette.mutedText }]}>{label}</Text>
        <Animated.View
          style={[
            styles.dot,
            {
              backgroundColor: palette.accent,
              opacity: emphasis,
              transform: [{ scale: emphasis }],
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  dock: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    height: DOCK_HEIGHT,
    padding: DOCK_PADDING,
    borderRadius: radius.md * 3,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  indicator: {
    position: 'absolute',
    top: DOCK_PADDING,
    bottom: DOCK_PADDING,
    left: DOCK_PADDING,
    borderRadius: radius.md * 3,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: { alignItems: 'center', gap: 4 },
  tabLabel: {
    fontSize: 14,
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
