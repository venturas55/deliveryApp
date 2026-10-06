const isDev = process.env.APP_VARIANT === "development";

const isAdmin = process.env.APP_TARGET === "admin";
const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || "";
const iosClientIdSuffix = ".apps.googleusercontent.com";

const iosUrlScheme = iosClientId
  ? `com.googleusercontent.apps.${iosClientId.replace(iosClientIdSuffix, "")}`
  : "com.googleusercontent.apps.CONFIGURE_IOS_CLIENT_ID";

module.exports = ({ config }) => {
  const googlePlugin = "react-native-nitro-google-signin";

  const existingPlugin = (config.plugins || []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === googlePlugin,
  );

  const existingScheme = existingPlugin?.[1]?.iosUrlScheme || "";
  const prefix = "com.googleusercontent.apps.";

  const resolvedClientId =
    iosClientId ||
    (existingScheme.startsWith(prefix) &&
    !existingScheme.includes("CONFIGURE_IOS_CLIENT_ID")
      ? `${existingScheme.slice(prefix.length)}${iosClientIdSuffix}`
      : "");

  const resolvedScheme = resolvedClientId
    ? `${prefix}${resolvedClientId.replace(iosClientIdSuffix, "")}`
    : iosUrlScheme;

  return {
    ...config,
    orientation: isAdmin ? "default" : config.orientation,

    // Diferenciar visualmente DEV de producción
    name: `Massa e fuoco${isAdmin ? " Admin" : ""}${isDev ? " DEV" : ""}`,
    scheme: `massaefuoco${isAdmin ? "-admin" : ""}${isDev ? "-dev" : ""}`,

    ios: {
      ...config.ios,
      supportsTablet: true,
      bundleIdentifier: isDev
        ? `com.massaefuoco.${isAdmin ? "admin" : "client"}.dev`
        : `com.massaefuoco.${isAdmin ? "admin" : "client"}`,
    },

    android: {
      ...config.android,
      package: isDev
        ? `com.massaefuoco.${isAdmin ? "admin" : "client"}.dev`
        : `com.massaefuoco.${isAdmin ? "admin" : "client"}`,
    },

    plugins: [
      ...(config.plugins || []).filter(
        (plugin) =>
          (Array.isArray(plugin) ? plugin[0] : plugin) !== googlePlugin,
      ),

      [
        googlePlugin,
        {
          ...existingPlugin?.[1],
          iosUrlScheme: resolvedScheme,
        },
      ],

      "expo-secure-store",
      ["expo-build-properties", { ios: { enableSceneSupport: true } }],
    ],

    extra: {
      ...config.extra,
      appTarget: isAdmin ? "admin" : "client",
      googleIosClientId: resolvedClientId || undefined,
    },
  };
};
