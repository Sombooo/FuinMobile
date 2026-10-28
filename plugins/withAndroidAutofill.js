const { withAndroidManifest, withDangerousMod, withAndroidStyles } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidAutofill = (config) => {
  // 1. Copy files in dangerous mod during prebuild
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const pluginAndroidDir = path.join(projectRoot, 'plugins', 'android');
      const targetJavaDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        'com',
        'sombooosteam',
        'fuin'
      );
      const targetResDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res');

      if (fs.existsSync(pluginAndroidDir)) {
        // Copy Java/Kotlin files
        const srcJava = path.join(pluginAndroidDir, 'java');
        if (fs.existsSync(srcJava) && fs.existsSync(targetJavaDir)) {
          fs.readdirSync(srcJava).forEach((f) => {
            fs.copyFileSync(path.join(srcJava, f), path.join(targetJavaDir, f));
          });
        }

        // Copy Layouts
        const srcLayout = path.join(pluginAndroidDir, 'res', 'layout');
        const targetLayout = path.join(targetResDir, 'layout');
        if (fs.existsSync(srcLayout)) {
          fs.mkdirSync(targetLayout, { recursive: true });
          fs.readdirSync(srcLayout).forEach((f) => {
            fs.copyFileSync(path.join(srcLayout, f), path.join(targetLayout, f));
          });
        }

        // Copy XML configs
        const srcXml = path.join(pluginAndroidDir, 'res', 'xml');
        const targetXml = path.join(targetResDir, 'xml');
        if (fs.existsSync(srcXml)) {
          fs.mkdirSync(targetXml, { recursive: true });
          fs.readdirSync(srcXml).forEach((f) => {
            fs.copyFileSync(path.join(srcXml, f), path.join(targetXml, f));
          });
        }

        // Copy Drawables
        const srcDrawable = path.join(pluginAndroidDir, 'res', 'drawable');
        const targetDrawable = path.join(targetResDir, 'drawable');
        if (fs.existsSync(srcDrawable)) {
          fs.mkdirSync(targetDrawable, { recursive: true });
          fs.readdirSync(srcDrawable).forEach((f) => {
            fs.copyFileSync(path.join(srcDrawable, f), path.join(targetDrawable, f));
          });
        }

        // Ensure MainApplication registers FuinAutofillPackage
        const mainAppFile = path.join(targetJavaDir, 'MainApplication.kt');
        if (fs.existsSync(mainAppFile)) {
          let mainAppContent = fs.readFileSync(mainAppFile, 'utf8');
          if (!mainAppContent.includes('FuinAutofillPackage()')) {
            mainAppContent = mainAppContent.replace(
              /PackageList\(this\)\.packages\.apply\s*\{/,
              'PackageList(this).packages.apply {\n          add(FuinAutofillPackage())'
            );
            fs.writeFileSync(mainAppFile, mainAppContent, 'utf8');
          }
        }
      }
      return config;
    },
  ]);

  // 2. Inject Theme.AutofillDialog into styles.xml
  config = withAndroidStyles(config, (config) => {
    try {
      if (!config.modResults.resources) {
        config.modResults.resources = {};
      }
      const styles = config.modResults.resources.style || [];
      const hasAutofillDialog = styles.some((s) => s.$ && s.$.name === 'Theme.AutofillDialog');
      if (!hasAutofillDialog) {
        styles.push({
          $: {
            name: 'Theme.AutofillDialog',
            parent: 'Theme.AppCompat.DayNight.Dialog',
          },
          item: [
            { $: { name: 'android:windowBackground' }, _: '@android:color/transparent' },
            { $: { name: 'android:windowNoTitle' }, _: 'true' },
            { $: { name: 'android:windowIsFloating' }, _: 'true' },
            { $: { name: 'android:windowElevation' }, _: '8dp' },
          ],
        });
        config.modResults.resources.style = styles;
      }
    } catch (e) {
      console.warn('[withAndroidAutofill] Failed to inject styles:', e);
    }
    return config;
  });

  // 3. Android Manifest registration
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];

    // Ensure service is declared
    mainApplication.service = mainApplication.service || [];
    const hasService = mainApplication.service.some(
      (s) => s.$['android:name'] === '.FuinAutofillService'
    );

    if (!hasService) {
      mainApplication.service.push({
        $: {
          'android:name': '.FuinAutofillService',
          'android:label': 'Fuin',
          'android:permission': 'android.permission.BIND_AUTOFILL_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.autofill.AutofillService',
                },
              },
            ],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.autofill',
              'android:resource': '@xml/autofill_service_config',
            },
          },
        ],
      });
    }

    // Ensure auth activity is declared (using Theme.AppCompat.DayNight.Dialog which is guaranteed to exist)
    mainApplication.activity = mainApplication.activity || [];
    const hasAuthActivity = mainApplication.activity.some(
      (a) => a.$['android:name'] === '.AutofillAuthActivity'
    );

    if (!hasAuthActivity) {
      mainApplication.activity.push({
        $: {
          'android:name': '.AutofillAuthActivity',
          'android:theme': '@style/Theme.AppCompat.DayNight.Dialog',
          'android:exported': 'false',
          'android:excludeFromRecents': 'true',
          'android:launchMode': 'singleTask',
        },
      });
    } else {
      // If already present, make sure theme is valid
      const authAct = mainApplication.activity.find((a) => a.$['android:name'] === '.AutofillAuthActivity');
      if (authAct && authAct.$) {
        authAct.$['android:theme'] = '@style/Theme.AppCompat.DayNight.Dialog';
      }
    }

    return config;
  });
};

module.exports = withAndroidAutofill;
