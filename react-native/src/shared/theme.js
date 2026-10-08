import React from "react";
import { Button } from "./ui";
import { useTheme } from "./theme-context";
import {
  View,
} from "react-native";

export { ThemeProvider, useTheme, useThemedStyles } from "./theme-context";

export function ThemeToggle({ small = false }) {
  const { dark, ready, toggle } = useTheme();

  return (
    <View
      style={
        small
          ? {
              transform: [{ scale: 0.5 }],
              alignSelf: "flex-start",
            }
          : undefined
      }
    >
      <Button
        secondary
        icon={dark ? "sunny-outline" : "moon-outline"}
        disabled={!ready}
        onPress={toggle}
      />
    </View>
  );
}