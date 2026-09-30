const iosClientId = process.env.GOOGLE_IOS_CLIENT_ID || "";
const iosClientIdSuffix = ".apps.googleusercontent.com";
const iosUrlScheme = iosClientId
  ? `com.googleusercontent.apps.${iosClientId.replace(iosClientIdSuffix, "")}`
  : "com.googleusercontent.apps.CONFIGURE_IOS_CLIENT_ID";

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []),
    ["react-native-nitro-google-signin", { iosUrlScheme }],
    ["expo-build-properties", { ios: { enableSceneSupport: true } }],
  ],
  extra: {
    ...config.extra,
    googleIosClientId: iosClientId || undefined,
  },
});
