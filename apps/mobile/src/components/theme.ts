export interface Palette {
  background: string;
  surface: string;
  border: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  danger: string;
  dangerSurface: string;
  success: string;
  warning: string;
  neutralSurface: string;
}

/**
 * The one app theme: near-black surfaces with a lime accent. It is the same on every screen and does not follow
 * the phone's light or dark setting, so the look matches the Home design everywhere.
 */
export const palette: Palette = {
  background: '#0A0C0F',
  surface: '#14171C',
  border: '#23282F',
  text: '#F4F6F8',
  mutedText: '#8B939F',
  accent: '#C8F542',
  accentText: '#0A0C0F',
  danger: '#FF7A70',
  dangerSurface: '#3A1D1B',
  success: '#C8F542',
  warning: '#F5B841',
  neutralSurface: '#1C2128',
};

/** Theme fonts. Space Grotesk is used for headings and labels, Plus Jakarta Sans for body text. */
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  display: 'SpaceGrotesk_500Medium',
  displayBold: 'SpaceGrotesk_700Bold',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 8 } as const;

export function usePalette(): Palette {
  return palette;
}
