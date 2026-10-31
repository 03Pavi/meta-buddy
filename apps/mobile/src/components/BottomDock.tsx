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

/** Space a screen should leave at its bottom so content is not hidden behind the dock. */
export const DOCK_SPACE = DOCK_HEIGHT + spacing.lg * 2;

/** The bottom dock shown on the three main screens. Its indicator slides to the active tab. */
export function BottomDock({ active }: { active: DockTab }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const tabWidth = (width - DOCK_MARGIN * 2 - DOCK_PADDING * 2) / TABS.length;
  const activeIndex = TABS.findIndex(tab => tab.name === active);
  const slide = useRef(new Animated.Value(activeIndex)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: activeIndex,
      damping: 18,
      stiffness: 200,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, slide]);

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
        {TABS.map(tab => {
          const isActive = tab.name === active;
          return (
            <Pressable
              key={tab.name}
              onPress={() => {
                if (!isActive) navigation.navigate(tab.name);
              }}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              style={styles.tab}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { color: isActive ? palette.accent : palette.mutedText, fontWeight: isActive ? '700' : '500' },
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
  tabLabel: {
    fontSize: 14,
  },
});
