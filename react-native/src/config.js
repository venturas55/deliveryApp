// Change this to the reachable API URL for your device/emulator.
export const API_BASE_URL = "https://massaefuoco.es/api";

export function productImageUrl(imageUrl, apiBaseUrl = API_BASE_URL) {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) return null;
  try {
    const url = new URL(imageUrl.trim(), new URL(apiBaseUrl).origin + "/");
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
