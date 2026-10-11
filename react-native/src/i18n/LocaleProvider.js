import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, AppState, NativeModules } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setDeviceLocales, supportedLanguages, t } from "./index";

const storageKey = "delivery-language";

function deviceLocales() {
  try { return require("expo-localization").getLocales(); }
  catch {
    const settings = NativeModules.SettingsManager?.settings;
    const tags = settings?.AppleLanguages || [settings?.AppleLocale || NativeModules.I18nManager?.localeIdentifier || Intl.DateTimeFormat().resolvedOptions().locale];
    return tags.map(languageTag => ({ languageTag }));
  }
}
const LocaleContext = createContext(null);
export function LocaleProvider({ children }) {
  const [current, setCurrent] = useState(() => setDeviceLocales(deviceLocales()));
  const [preference, setPreferenceState] = useState("system");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preferenceRef = useRef("system"), savingRef = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const update = () => setCurrent(setDeviceLocales(deviceLocales(), preferenceRef.current));
    AsyncStorage.getItem(storageKey).then(saved => {
      if (!alive) return;
      const value = supportedLanguages.includes(saved) ? saved : "system";
      preferenceRef.current = value;
      setPreferenceState(value);
      update();
    }).catch(() => { if (alive) setError("No se pudo recuperar el idioma guardado."); })
      .finally(() => { if (alive) setReady(true); });
    const state = AppState.addEventListener("change", value => { if (value === "active") update(); });
    let listener;
    try { listener = require("expo-localization").addLocaleListener?.(update); } catch {}
    return () => { alive = false; mounted.current = false; state.remove(); listener?.remove(); };
  }, []);
  const setPreference = useCallback(async value => {
    if (!ready || savingRef.current || !["system", ...supportedLanguages].includes(value)) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await AsyncStorage.setItem(storageKey, value);
      if (!mounted.current) return;
      preferenceRef.current = value;
      setPreferenceState(value);
      setCurrent(setDeviceLocales(deviceLocales(), value));
    } catch {
      if (mounted.current) setError("No se pudo guardar el idioma. Inténtalo de nuevo.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [ready]);
  return <LocaleContext.Provider value={{ ...current, preference, setPreference, ready, saving, error }}>{children}</LocaleContext.Provider>;
}
export const useLocale = () => useContext(LocaleContext);
export const LocalizedAlert = {
  alert(title, message, buttons, options) {
    Alert.alert(t(title), t(message), buttons?.map(button => ({ ...button, text: t(button.text) })), options);
  },
};
