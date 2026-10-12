const { withAppBuildGradle } = require("expo/config-plugins");

// Keep this change in prebuild so EAS-generated projects use optimized R8 rules.
module.exports = function withAndroidReleaseOptimization(config) {
  return withAppBuildGradle(config, (config) => {
    const { contents } = config.modResults;
    const legacyRules = /getDefaultProguardFile\((["'])proguard-android\.txt\1\)/g;
    if (!legacyRules.test(contents) && !contents.includes("proguard-android-optimize.txt")) {
      throw new Error("Android release optimization: default ProGuard rules not found. Review the generated app/build.gradle.");
    }
    config.modResults.contents = contents.replace(legacyRules, 'getDefaultProguardFile("proguard-android-optimize.txt")');
    return config;
  });
};
