import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ThemeContext = createContext(null);
const storageKey = "delivery-theme";
const textColors = {
  "#392d27": "#e4ece6", "#332820": "#e4ece6", "#51483f": "#d4dfd7",
  "#53483e": "#d4dfd7", "#713923": "#e4ece6", "#777067": "#b0beb4",
  "#70675e": "#b0beb4", "#716a61": "#b0beb4", "#817d75": "#b0beb4",
  "#78716c": "#b0beb4", "#9d3d24": "#f0a58e", "#923a25": "#f0a58e",
  "#862c1b": "#ffb4a6", "#872419": "#ffb4a6", "#9f2525": "#ffb4a6",
  "#274f2d": "#91d8a2", "#275c91": "#93c5fd", "#865e13": "#f5ce83",
  "#276944": "#91d8a2", "#62418c": "#ceb0f4", "#8b2c2c": "#ffb4a6",
};
const backgrounds = {
  "#f7f4ee": "#111815", "#fff": "#1b2520", "#eee8df": "#202d25",
  "#efe7db": "#202d25", "#e9e3d9": "#202d25", "#f4eee5": "#202d25",
  "#fce8da": "#3b3024", "#fbe5de": "#3b2422", "#fff0ed": "#3b2422",
};
const borders = ["#e4ded3", "#e6ded3", "#d6c9ba"];

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("light");
  const [ready, setReady] = useState(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(storageKey).then(saved => {
      if (alive && (saved === "dark" || saved === "light")) setTheme(saved);
    }).catch(() => {}).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  const value = useMemo(() => ({
    dark: theme === "dark", ready,
    color: (original, property = "color") => {
      if (theme !== "dark") return original;
      if (property === "backgroundColor") return backgrounds[original] || original;
      if (property.startsWith("border")) return borders.includes(original) ? "#35453b" : original;
      return textColors[original] || original;
    },
    toggle: () => {
      const next = theme === "dark" ? "light" : "dark";
      setTheme(next);
      writes.current = writes.current.then(() => AsyncStorage.setItem(storageKey, next))
        .catch(() => Alert.alert("Tema", "No se pudo guardar el tema. Inténtalo de nuevo."));
    },
  }), [theme, ready]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }

export function useThemedStyles(styles) {
  const { color } = useTheme();
  return useMemo(() => Object.fromEntries(Object.entries(styles).map(([name, style]) => [
    name, Object.fromEntries(Object.entries(style).map(([property, value]) => [
      property, typeof value === "string" && value.startsWith("#") ? color(value, property) : value,
    ])),
  ])), [styles, color]);
}

export function ThemeToggle() {
  const { dark, ready, toggle, color } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: dark, disabled: !ready }}
    disabled={!ready} onPress={toggle}
    style={{ alignSelf: "flex-start", minHeight: 44, padding: 12, marginVertical: 4, borderRadius: 10,
      backgroundColor: color("#eee8df", "backgroundColor") }}>
    <Text style={{ color: color("#51483f"), fontWeight: "600" }}>
      {dark ? "◐ Tema claro" : "◐ Tema oscuro"}
    </Text>
  </Pressable>;
}
