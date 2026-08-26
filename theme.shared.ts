// The plugin theme has no border/raised tokens. Values below replicate the
// app's palette derivation (packages/app/src/styles/theme.ts): surface1 ≈
// foreground@3.5%, surface2 ≈ foreground@7% over surface0. Hex colors get an
// alpha channel appended; anything else passes through unchanged.
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  if (/^[0-9a-fA-F]{3}$/.test(hex) || /^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex}${channel}`;
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    return `#${hex.slice(0, 6)}${channel}`;
  }
  return color;
}
