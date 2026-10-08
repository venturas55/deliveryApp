import React from "react";
import { Button } from "./ui";
import { useTheme } from "./theme-context";

export { ThemeProvider, useTheme, useThemedStyles } from "./theme-context";

export function ThemeToggle() {
  const { dark, ready, toggle } = useTheme();

  return (
    <Button
      secondary
      icon={dark ? "sunny-outline" : "moon-outline"}
      title={dark ? "Tema claro" : "Tema oscuro"}
      disabled={!ready}
      onPress={toggle}
    />
  );
}