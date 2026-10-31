import React from 'react';
import { StyleSheet, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { fonts } from './theme';

/**
 * Text in the app's theme fonts. The font follows the old font weight and size: headings (18 and up, bold) use
 * Space Grotesk, labels (weight 500) use Space Grotesk, and body text uses Plus Jakarta Sans.
 * Use this instead of React Native's Text so every screen shares one look.
 */
export function Text({ style, ...rest }: TextProps) {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const { fontWeight, fontFamily, ...others } = flat;
  const weight = fontWeight ? String(fontWeight) : '400';
  const size = flat.fontSize ?? 16;
  const bold = weight === '600' || weight === '700' || weight === '800' || weight === 'bold';

  let family: string = fonts.regular;
  if (fontFamily) {
    family = fontFamily;
  } else if (bold && size >= 18) {
    family = fonts.displayBold;
  } else if (weight === '500') {
    family = fonts.display;
  } else if (weight === '700' || weight === '800' || weight === 'bold') {
    family = fonts.bold;
  } else if (bold) {
    family = fonts.semibold;
  }

  return <NativeText {...rest} style={[others, { fontFamily: family }]} />;
}
