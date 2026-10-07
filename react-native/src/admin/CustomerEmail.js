import React, { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, useStyles } from "../shared/ui";
import useAdminData from "./useAdminData";
import { write } from "./api";

export default function CustomerEmail({ customer, close }) {
  const s = useStyles();
  const broadcast = !customer;
  const recipients = useAdminData(
    broadcast ? "/customers/email/recipients" : null,
  );
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [image, setImage] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const sending = useRef(false);
  async function pickImage() {
    setPicking(true);
    setError("");
    try {
      const DocumentPicker = require("expo-document-picker");
      const selection = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png", "image/gif"],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      console.log("Selected image:", asset);
      if (
        !asset ||
        !["image/jpeg", "image/png", "image/gif"].includes(asset.mimeType)
      )
        throw new Error("Selecciona una imagen JPEG, PNG o GIF válidO.");
      if (asset.size > 5 * 1024 * 1024)
        throw new Error("La imagen no puede superar 5 MB.");
      console.log("MIME:", asset.mimeType);
      console.log(
        "MIME VALIDO:",
        ["image/jpeg", "image/png", "image/gif"].includes(asset.mimeType),
      );

      setImage(asset);
      console.log("IMAGEN ACEPTADA");
    } catch (failure) {
      setError(
        /Cannot find native module.*ExpoDocumentPicker/.test(failure.message)
          ? "La versión instalada no permite adjuntar imágenes. Actualiza la aplicación con una nueva compilación. Puedes enviar el correo sin imagen."
          : failure.message,
      );
    } finally {
      setPicking(false);
    }
  }
  async function send() {
    if (sending.current || result) return;

    if (
      !subject.trim() ||
      subject.trim().length > 160 ||
      /[\r\n]/.test(subject) ||
      !message.trim()
    ) {
      setError("Indica un asunto válido y escribe el mensaje.");
      return;
    }

    if (broadcast && (!confirmed || !recipients.data?.total)) return;

    sending.current = true;
    setBusy(true);
    setError("");

    try {
      const body = new FormData();

      body.append("subject", subject.trim());
      body.append("message", message.trim());

      if (broadcast) {
        body.append("confirm", "yes");
      }

      if (image) {
        if (Platform.OS === "web") {
          body.append("image", image.file, image.name);
        } else {
          const response = await fetch(image.uri);
          const rawBlob = await response.blob();
          const blob = new Blob([rawBlob], {
            type: image.mimeType || "image/jpeg",
          });
          body.append("image", blob, image.name || "image.jpg");
        }
      }

      setResult(
        await write(
          broadcast
            ? "/customers/email"
            : `/customers/${encodeURIComponent(customer.id)}/email`,
          body,
        ),
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const locked = busy || picking || !!result;
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!busy && !picking) close();
      }}
    >
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[s.content, s.form]}
          >
            <Text style={s.title}>
              {broadcast ? "Nueva comunicación" : "Enviar correo"}
            </Text>
            <Text style={s.muted}>
              {broadcast
                ? `Clientes del restaurante con email: ${recipients.data?.total ?? "…"}. Incluye todos, aunque la lista tenga filtros.`
                : `${customer.name} · ${customer.email}`}
            </Text>
            {recipients.error ? (
              <>
                <Text accessibilityRole="alert" style={s.error}>
                  {recipients.error}
                </Text>
                <Button
                  secondary
                  title="Reintentar"
                  onPress={recipients.refresh}
                />
              </>
            ) : null}
            <Field
              label="Asunto"
              value={subject}
              onChangeText={setSubject}
              maxLength={160}
              editable={!locked}
            />
            <Field
              label="Mensaje"
              value={message}
              onChangeText={setMessage}
              maxLength={10000}
              multiline
              textAlignVertical="top"
              editable={!locked}
              style={[s.input, { minHeight: 160 }]}
            />
            <Text style={s.muted}>
              Imagen opcional: JPEG, PNG o GIF, máximo 5 MB. Apareece en el
              correo y enlaza a la web.
            </Text>
            {image ? (
              <>
                <Image
                  source={{ uri: image.uri }}
                  resizeMode="contain"
                  style={{ width: "100%", height: 220 }}
                />
                <Text style={s.muted}>{image.name}</Text>
                <Button
                  secondary
                  title="Quitar imagen"
                  disabled={locked}
                  onPress={() => setImage(null)}
                />
              </>
            ) : null}
            <Button
              secondary
              title={picking ? "Seleccionando…" : "Adjuntar imagen"}
              disabled={locked}
              onPress={pickImage}
            />
            {broadcast ? (
              <View style={s.row}>
                <Text style={[s.text, { flex: 1 }]}>
                  Confirmo el envío a todos los clientes del restaurante.
                </Text>
                <Switch
                  accessibilityLabel="Confirmar envío a todos"
                  value={confirmed}
                  onValueChange={setConfirmed}
                  disabled={locked}
                />
              </View>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            ) : null}
            {result ? (
              <Text accessibilityLiveRegion="polite" style={s.text}>
                Enviados: {result.sent}. Fallidos: {result.failed}. Total:{" "}
                {result.total}.
              </Text>
            ) : null}
            {!result ? (
              <Button
                title={
                  busy
                    ? "Enviando…"
                    : broadcast
                      ? "Nueva comunicación"
                      : "Enviar correo"
                }
                onPress={send}
                disabled={
                  locked ||
                  !subject.trim() ||
                  !message.trim() ||
                  (broadcast &&
                    (!confirmed ||
                      !recipients.data?.total ||
                      !!recipients.error))
                }
              />
            ) : null}
            <Button
              secondary
              title={result ? "Cerrar" : "Cancelar"}
              onPress={close}
              disabled={busy || picking}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
