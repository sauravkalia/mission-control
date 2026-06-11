import type { ITheme } from '@xterm/xterm'

// Design.md §1 — full 16-color theme, desaturated one notch and tinted toward
// the console so Claude's output reads native inside the green room.
export const mocrTermTheme: ITheme = {
  background: '#040605',
  foreground: '#D7E2DA',
  cursor: '#51F08A',
  cursorAccent: '#040605',
  selectionBackground: 'rgba(81, 240, 138, 0.22)',
  black: '#121A15',
  brightBlack: '#5B6E62',
  red: '#E06055',
  brightRed: '#FF6F61',
  green: '#4DC97D',
  brightGreen: '#6FE8A0',
  yellow: '#D9B25C',
  brightYellow: '#EFC97E',
  blue: '#6E9ECF',
  brightBlue: '#8FB8E0',
  magenta: '#B48EC7',
  brightMagenta: '#CDA8DE',
  cyan: '#56BFAE',
  brightCyan: '#79D9C6',
  white: '#B9C7BD',
  brightWhite: '#E8F2EA',
  // xterm 6 rewrote the scrollbar — theme it or it ships stock (gotcha 50)
  scrollbarSliderBackground: 'rgba(81, 240, 138, 0.10)',
  scrollbarSliderHoverBackground: 'rgba(81, 240, 138, 0.18)',
  scrollbarSliderActiveBackground: 'rgba(81, 240, 138, 0.25)',
}
