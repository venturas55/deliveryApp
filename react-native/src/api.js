import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./config";

const REFRESH_TOKEN_KEY = "refreshToken";
const LEGACY_ACCESS_TOKEN_KEY = "customerToken";
const SESSION_ROLE_KEY = "sessionRole";
let accessToken = null;
let refreshInFlight = null;
let logoutInProgress = false;
let authLostHandler = () => {};

async function responseData(response) {
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : null;
}

async function rawRequest(path, options = {}, token) {
  const headers = {
    Accept: "application/json",
    ...(typeof options.body === "string"
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
  return { response, data: await responseData(response) };
}

async function clearStoredSession() {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(SESSION_ROLE_KEY);
}

async function refreshAccessToken() {
  if (logoutInProgress) return null;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) {
        accessToken = null;
        return null;
      }

      const { response, data } = await rawRequest("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (response.status === 401) {
        await clearStoredSession();
        authLostHandler();
        return null;
      }
      if (!response.ok)
        throw new Error(data?.error || `Error ${response.status}`);
      if (
        typeof data?.accessToken !== "string" ||
        typeof data?.refreshToken !== "string"
      )
        throw new Error("El servidor devolvió una sesión no válida.");

      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
      accessToken = data.accessToken;
      return accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function setAuthLostHandler(handler) {
  authLostHandler = typeof handler === "function" ? handler : () => {};
}

export async function saveSession(data) {
  const newAccessToken = data?.accessToken || data?.token;
  if (
    typeof newAccessToken !== "string" ||
    typeof data?.refreshToken !== "string"
  )
    throw new Error("El servidor no devolvió los tokens de sesión.");
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
  accessToken = newAccessToken;
  await SecureStore.setItemAsync(SESSION_ROLE_KEY, data.admin ? "admin" : "customer");
  return newAccessToken;
}

export async function getSessionRole() {
  return (await SecureStore.getItemAsync(SESSION_ROLE_KEY)) === "admin" ? "admin" : "customer";
}

export async function restoreSession() {
  await AsyncStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  if (accessToken) return accessToken;
  return refreshAccessToken();
}

export async function logoutSession() {
  logoutInProgress = true;
  let failure;
  try {
    if (refreshInFlight) {
      try {
        await refreshInFlight;
      } catch (error) {
        failure = error;
      }
    }
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      const { response, data } = await rawRequest("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok)
        throw new Error(data?.error || `Error ${response.status}`);
    }
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "No se pudo revocar la sesión.")
      : error;
  }
  try {
    await clearStoredSession();
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "No se pudo limpiar la sesión.")
      : error;
  }
  logoutInProgress = false;
  if (failure) throw failure;
}

export async function api(path, options = {}, token) {
  const requestToken = accessToken || token || null;
  const first = await rawRequest(path, options, requestToken);
  if (first.response.status === 401 && requestToken) {
    let renewedToken = accessToken && accessToken !== requestToken
      ? accessToken
      : await refreshAccessToken();
    if (renewedToken) {
      const retry = await rawRequest(path, options, renewedToken);
      if (!retry.response.ok)
        throw new Error(retry.data?.error || `Error ${retry.response.status}`);
      return retry.data;
    }
  }
  if (!first.response.ok)
    throw new Error(first.data?.error || `Error ${first.response.status}`);
  return first.data;
}
