import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { api } from "./api";
import { productImageUrl } from "./config";
import { Button, Card, Field, useStyles } from "./shared/ui";

function savedAddress(profile) {
  if (!profile?.delivery_place_id) return null;
  return Object.fromEntries(["formatted_address", "street", "number", "city", "province",
    "postal_code", "country", "latitude", "longitude", "place_id"].map(key => [key, profile[`delivery_${key}`]]));
}

export default function CustomerAccount({ profile, token, onUpdated, onLogout }) {
  const s = useStyles();
  const dirty = useRef(false), operation = useRef(false);
  const [name, setName] = useState(profile?.name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [apartment, setApartment] = useState(profile?.delivery_apartment || "");
  const [notes, setNotes] = useState(profile?.delivery_notes || "");
  const [address, setAddress] = useState(() => savedAddress(profile));
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [brokenImage, setBrokenImage] = useState(false);
  const avatar = image?.uri || productImageUrl(profile?.profile_image_url);

  useEffect(() => {
    if (dirty.current) return;
    setName(profile?.name || "");
    setPhone(profile?.phone || "");
    setApartment(profile?.delivery_apartment || "");
    setNotes(profile?.delivery_notes || "");
    setAddress(savedAddress(profile));
  }, [profile]);
  useEffect(() => setBrokenImage(false), [avatar]);

  useEffect(() => {
    const query = search.trim();
    setSuggestions([]);
    setSearchError("");
    setSearching(false);
    if (query.length < 3 || address) return;
    const controller = new AbortController();
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api(`/customer-auth/address-search?q=${encodeURIComponent(query)}`, { signal: controller.signal }, token);
        if (alive) {
          setSuggestions(results);
          if (!results.length) setSearchError("Sin resultados. Incluye calle, número y municipio.");
        }
      } catch (failure) {
        if (alive && failure.name !== "AbortError") setSearchError(failure.message);
      } finally { if (alive) setSearching(false); }
    }, 400);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [search, address, token]);

  function edit(setter, value) {
    dirty.current = true;
    setSaved("");
    setter(value);
  }
  async function save() {
    if (operation.current) return;
    setError("");
    setSaved("");
    if (!name.trim()) return setError("Indica tu nombre.");
    if (search.trim() && !address) return setError("Selecciona una dirección de las sugerencias.");
    operation.current = true;
    setBusy(true);
    try {
      await api("/customer-auth/me", {
        method: "PATCH",
        body: JSON.stringify({ name, phone, delivery_apartment: apartment, delivery_notes: notes,
          ...(address ? { delivery_address_data: address } : {}) }),
      }, token);
      dirty.current = false;
      setSearch("");
      await onUpdated();
      setSaved("Datos guardados.");
    } catch (failure) { setError(failure.message); }
    finally { operation.current = false; setBusy(false); }
  }
  async function pickPhoto() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const picker = require("expo-document-picker");
      const result = await picker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp"], multiple: false, copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType)) throw new Error("Selecciona una foto JPG, PNG o WebP.");
      if (asset.size > 5 * 1024 * 1024) throw new Error("La imagen no puede superar 5 MB.");
      setImage(asset);
    } catch (failure) {
      setError(/Cannot find native module.*ExpoDocumentPicker/.test(failure.message)
        ? "Para seleccionar fotos, instala una nueva compilación de la aplicación con expo-document-picker."
        : failure.message);
    } finally { operation.current = false; setBusy(false); }
  }
  async function uploadPhoto() {
    if (!image || operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const form = new FormData();
      form.append("image", { uri: image.uri, name: image.name || "profile", type: image.mimeType });
      await api("/customer-auth/me/photo", { method: "POST", body: form }, token);
      await onUpdated();
      setImage(null);
      setSaved("Foto guardada.");
    } catch (failure) { setError(failure.message); }
    finally { operation.current = false; setBusy(false); }
  }

  return <View style={{ gap: 16 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      {avatar && !brokenImage ? <Image source={{ uri: avatar }} onError={() => setBrokenImage(true)}
        accessibilityLabel={`Foto de perfil de ${profile?.name || "cliente"}`} style={{ width: 80, height: 80, borderRadius: 40 }} />
        : <Text accessibilityLabel="Sin foto de perfil" style={{ fontSize: 48 }}>👤</Text>}
      <View style={{ flex: 1 }}><Text accessibilityRole="header" style={s.title}>Mi cuenta</Text>
        <Text style={s.muted}>Datos y dirección habitual para tus pedidos.</Text></View>
    </View>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!!saved && <Text accessibilityLiveRegion="polite" style={s.text}>{saved}</Text>}
    <Card>
      <Text style={s.heading}>Foto de perfil</Text>
      <Text style={s.muted}>JPG, PNG o WebP; máximo 5 MB.</Text>
      <Button secondary title="Seleccionar foto" onPress={pickPhoto} disabled={busy} />
      {image && <><Button title="Subir foto" onPress={uploadPhoto} disabled={busy} />
        <Button secondary title="Cancelar selección" onPress={() => setImage(null)} disabled={busy} /></>}
    </Card>
    <Card>
      <Field label="Email de acceso" value={profile?.email || ""} editable={false} autoCapitalize="none" />
      <Field label="Nombre" value={name} onChangeText={value => edit(setName, value)} maxLength={120} autoComplete="name" editable={!busy} />
      <Field label="Teléfono" value={phone} onChangeText={value => edit(setPhone, value)} maxLength={40} keyboardType="phone-pad" autoComplete="tel" editable={!busy} />
      <Field label="Buscar dirección" value={search} onChangeText={value => {
        edit(setSearch, value);
        setAddress(value.trim() ? null : savedAddress(profile));
      }} placeholder="Calle Alcalá 123, Madrid" maxLength={200} autoCorrect={false} autoCapitalize="none" editable={!busy} />
      {searching && <ActivityIndicator />}
      {!!searchError && <Text accessibilityRole="alert" style={s.error}>{searchError}</Text>}
      {suggestions.map(item => <Button key={item.place_id} secondary title={item.suggestion || item.formatted_address}
        disabled={busy} onPress={() => { edit(setAddress, item); setSearch(""); setSuggestions([]); }} />)}
      {address && <View style={{ marginBottom: 16 }}>
        <Text style={s.heading}>Dirección seleccionada</Text>
        <Text style={s.text}>{address.street} {address.number}</Text>
        <Text style={s.muted}>{address.formatted_address}</Text>
        <Text style={s.muted}>{[address.city, address.postal_code, address.country].filter(Boolean).join(" · ")}</Text>
      </View>}
      <Field label="Puerta / piso / apartamento" value={apartment} onChangeText={value => edit(setApartment, value)} maxLength={20} placeholder="3º B" autoComplete="address-line2" editable={!busy} />
      <Field label="Instrucciones al repartidor" value={notes} onChangeText={value => edit(setNotes, value)} maxLength={500} multiline editable={!busy} />
      <Button title={busy ? "Procesando…" : "Guardar datos"} onPress={save} disabled={busy} />
    </Card>
    <Button secondary title="Cerrar sesión" onPress={onLogout} disabled={busy} />
  </View>;
}
