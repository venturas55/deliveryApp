import { useTheme, useThemedStyles } from "./theme";
import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

export const money = cents => (Number(cents || 0) / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
export const date = value => new Date(value).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const paymentName = value => ({ cash: "Efectivo", card_on_delivery: "Tarjeta al entregar", online: "Tarjeta online" }[value] || value);
export const paymentStatus = value => ({ pending: "Pendiente", paid: "Pagado", failed: "Fallido", cancelled: "Cancelado", refunded: "Reembolsado", refund_pending: "Devolución en curso" }[value] || value);

export function Button({ title, onPress, disabled, secondary, danger }) {
  const { color } = useTheme();
  const s = useThemedStyles(baseStyles);
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, danger && s.danger, (disabled || pressed) && { opacity: .55 }]}>
    <Text style={[s.buttonText, secondary && { color: color("#713923", "color") }]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, ...props }) {
  const { color } = useTheme();
  const s = useThemedStyles(baseStyles);
  return <View style={{ marginBottom: 12 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={color("#78716c", "placeholderTextColor")} style={s.input} {...props} /></View>;
}
export function Card({ children, onPress }) {
  const { color } = useTheme();
  const s = useThemedStyles(baseStyles);
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={s.card}>{children}</Pressable> : <View style={s.card}>{children}</View>;
}
const baseStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f4ee" },
  content: { padding: 18, paddingBottom: 32, gap: 12 },
  responsiveContent: { width: "100%", maxWidth: 1120, alignSelf: "center" },
  form: { width: "100%", maxWidth: 640, alignSelf: "center" },
  header: { padding: 18, borderBottomWidth: 1, borderBottomColor: "#e6ded3", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontSize: 23, fontWeight: "800", color: "#392d27" },
  heading: { fontSize: 18, fontWeight: "700", color: "#392d27", marginBottom: 8, flexShrink: 1 },
  text: { fontSize: 16, color: "#392d27", lineHeight: 24, flexShrink: 1 },
  muted: { fontSize: 14, color: "#70675e", lineHeight: 21 },
  label: { fontSize: 14, fontWeight: "600", color: "#53483e", marginBottom: 6 },
  card: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e6ded3", borderRadius: 16, padding: 16, gap: 5 },
  input: { borderWidth: 1, borderColor: "#d6c9ba", backgroundColor: "#fff", borderRadius: 12, padding: 14, fontSize: 16, color: "#392d27", minHeight: 48 },
  button: { backgroundColor: "#923a25", borderRadius: 12, minHeight: 48, minWidth: 48, padding: 14, justifyContent: "center", alignItems: "center", marginVertical: 4 },
  secondary: { backgroundColor: "#efe7db" },
  danger: { backgroundColor: "#a32121" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: "#9f2525", backgroundColor: "#fff0ed", padding: 12, borderRadius: 10, fontSize: 15 },
  chip: { paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, justifyContent: "center", borderRadius: 24, backgroundColor: "#efe7db" },
  chipActive: { backgroundColor: "#392d27" },
});

export function useStyles() { return useThemedStyles(baseStyles); }
