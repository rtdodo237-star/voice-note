// 앱 안 업데이트 (안드로이드): GitHub 릴리스에 새 APK가 올라오면 알려주고, 내려받아 설치 화면을 연다.
// 안드로이드 보안상 마지막 '업데이트' 버튼은 사용자가 한 번 눌러야 함 (스토어 밖 앱 공통).
// 같은 서명키로 빌드하므로 기존 앱 위에 업데이트되고 녹음은 그대로 남는다.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { startActivityAsync } from 'expo-intent-launcher';
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';

const LATEST = 'https://api.github.com/repos/rtdodo237-star/voice-note/releases/latest';
const LAST_CHECK = 'voice-note/update-check';
const CHECK_EVERY_MS = 3 * 60 * 60 * 1000; // 3시간마다 자동 확인

export interface UpdateInfo {
  version: string; // 예: 1.0.7
  build: number; // 예: 7 (versionCode)
  url: string; // APK 다운로드 주소
  size: number; // 바이트
}

export const supported = Platform.OS === 'android';
export const currentVersion = (): string => Application.nativeApplicationVersion || '';
export const currentBuild = (): number => Number(Application.nativeBuildVersion || 0);

/** 새 버전이 있으면 정보, 없으면 null. force=false면 3시간 안에 이미 확인했을 때 건너뜀 */
export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  if (!supported) return null;
  if (!force) {
    const last = Number((await AsyncStorage.getItem(LAST_CHECK)) || 0);
    if (Date.now() - last < CHECK_EVERY_MS) {
      const cached = await AsyncStorage.getItem(LAST_CHECK + ':info');
      const info: UpdateInfo | null = cached ? JSON.parse(cached) : null;
      return info && info.build > currentBuild() ? info : null;
    }
  }
  const res = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`업데이트 정보를 받지 못했어요 (${res.status})`);
  const rel = await res.json();
  const tag: string = rel.tag_name || '';
  const build = Number((tag.match(/(\d+)$/) || [])[1] || 0);
  const apk = (rel.assets || []).find((a: { name: string }) => /\.apk$/i.test(a.name));
  const info: UpdateInfo | null = apk && build ? { version: tag.replace(/^v/, ''), build, url: apk.browser_download_url, size: apk.size || 0 } : null;
  await AsyncStorage.setItem(LAST_CHECK, String(Date.now()));
  await AsyncStorage.setItem(LAST_CHECK + ':info', JSON.stringify(info));
  return info && info.build > currentBuild() ? info : null;
}

/** 새 APK를 내려받고 안드로이드 설치 화면을 연다 */
export async function downloadAndInstall(info: UpdateInfo, onProgress?: (ratio: number) => void): Promise<void> {
  const dest = new File(Paths.cache, `voice-note-${info.version}.apk`);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(info.url, dest, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : info.size;
      if (total > 0) onProgress?.(Math.min(1, bytesWritten / total));
    },
  });
  onProgress?.(1);
  const contentUri = await getContentUriAsync(file.uri);
  await startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION — 설치 화면이 파일을 읽을 수 있게
  });
}

export const formatMB = (bytes: number) => (bytes > 0 ? `${(bytes / 1048576).toFixed(0)}MB` : '');
