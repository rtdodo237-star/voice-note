// app.json 설정을 그대로 쓰고, 빌드 번호만 자동으로 올린다.
// (클라우드 빌드 때 BUILD_NUMBER가 1, 2, 3… 으로 들어와서 새 APK가 기존 앱 위에 업데이트로 설치됨)
import type { ConfigContext, ExpoConfig } from 'expo/config';

const buildNumber = Number(process.env.BUILD_NUMBER ?? '1');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? '녹음 노트',
  slug: config.slug ?? 'voice-note',
  version: `1.0.${buildNumber}`,
  android: {
    ...config.android,
    versionCode: buildNumber,
  },
  ios: {
    ...config.ios,
    buildNumber: String(buildNumber),
  },
});
