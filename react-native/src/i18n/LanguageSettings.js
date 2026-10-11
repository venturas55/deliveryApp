import React from "react";
import { Text, View } from "react-native";
import { Button, Card, useStyles } from "../shared/ui";
import { useLocale } from "./LocaleProvider";
import { t } from "./index";

export default function LanguageSettings() {
  const s = useStyles();
  const { preference, setPreference, ready, saving, error } = useLocale();
  return <Card>
    <Text accessibilityRole="header" style={s.heading}>{t("Idioma de la interfaz")}</Text>
    <Text style={s.muted}>{t("Se guarda en esta aplicación en este dispositivo.")}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {[["system", t("Idioma del dispositivo")], ["es", "Español"], ["en", "English"]].map(([value, label]) => (
        <Button key={value} chip title={label} selected={preference === value}
          disabled={!ready || saving} onPress={() => setPreference(value)} />
      ))}
    </View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{t(error)}</Text>}
  </Card>;
}
