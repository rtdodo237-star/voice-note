// 앱 진입점 — 권한 요청, 오디오 설정, 화면 전환
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, StyleSheet, ToastAndroid, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  requestNotificationPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import HomeScreen from './src/screens/HomeScreen';
import RecordScreen from './src/screens/RecordScreen';
import DetailScreen from './src/screens/DetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import UpdateCard from './src/screens/UpdateCard';
import ShareScreen from './src/screens/ShareScreen';
import { useShareIntent } from 'expo-share-intent';
import { File } from 'expo-file-system';
import { checkForUpdate } from './src/updater';
import type { UpdateInfo } from './src/updater';
import { loadSettings, refreshStatus, sendRecording, syncPending } from './src/sync';
import { ENABLE_BACKGROUND_RECORDING, getMode } from './src/modes';
import type { ModeId } from './src/modes';
import {
  addRecording,
  loadLastMode,
  loadRecordings,
  removeRecording,
  saveLastMode,
} from './src/storage';
import type { RecordingItem } from './src/storage';

type Screen =
  | { name: 'home' }
  | { name: 'record'; mode: ModeId }
  | { name: 'detail'; id: string }
  | { name: 'settings' }
  | { name: 'share'; text: string; title?: string | null };

/** 짧은 알림 (안드로이드는 토스트, 그 외는 생략) */
const notify = (msg: string) => {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
};

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [mode, setMode] = useState<ModeId>('consult');
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [connected, setConnected] = useState(false);

  // 다른 앱(갤럭시 녹음 앱 등)에서 '공유'로 받은 받아쓰기 글
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (!hasShareIntent) return;
    (async () => {
      let text = shareIntent.text || '';
      // .txt 파일로 공유된 경우 파일 내용 읽기
      if (!text.trim() && shareIntent.files?.length) {
        for (const f of shareIntent.files) {
          if (!/text|plain|markdown/i.test(f.mimeType || '') && !/\.(txt|md)$/i.test(f.fileName || '')) continue;
          try {
            text += (text ? '\n\n' : '') + (await new File(f.path).text());
          } catch {
            /* 읽지 못한 파일은 건너뜀 */
          }
        }
      }
      setScreen({ name: 'share', text, title: shareIntent.meta?.title });
      resetShareIntent();
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  const refresh = useCallback(async () => setRecordings(await loadRecordings()), []);

  // 말씀노트 연결: 못 보낸 녹음 보내기 + 받아쓰기 상태 받아오기 (앱 열 때 · 앱으로 돌아올 때)
  const syncNow = useCallback(async () => {
    const s = await loadSettings();
    setConnected(!!s);
    if (!s) return;
    await syncPending(refresh).catch(() => 0);
    if (await refreshStatus().catch(() => false)) await refresh();
  }, [refresh]);

  // 앱 안 업데이트: 열 때 · 돌아올 때 새 버전 확인 (3시간에 한 번만 실제 확인)
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateHidden, setUpdateHidden] = useState(false);
  const checkUpdate = useCallback(() => {
    checkForUpdate()
      .then((u) => setUpdate(u))
      .catch(() => {});
  }, []);

  useEffect(() => {
    syncNow();
    checkUpdate();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        syncNow();
        checkUpdate();
      }
    });
    return () => sub.remove();
  }, [syncNow, checkUpdate]);

  useEffect(() => {
    (async () => {
      setRecordings(await loadRecordings());
      const last = await loadLastMode();
      if (last) setMode(last);
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        allowsBackgroundRecording: ENABLE_BACKGROUND_RECORDING,
      });
    })();
  }, []);

  const selectMode = (m: ModeId) => {
    setMode(m);
    saveLastMode(m);
  };

  const startRecording = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('마이크 권한이 필요해요', '설정에서 마이크 접근을 허용해 주세요.', [
        { text: '닫기', style: 'cancel' },
        { text: '설정 열기', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    // 안드로이드: 백그라운드 녹음 중 '녹음 중' 알림(정지 버튼 포함)을 알림창에 띄우기 위한 권한
    // 거부해도 녹음은 정상 동작함
    if (Platform.OS === 'android' && ENABLE_BACKGROUND_RECORDING) {
      try {
        await requestNotificationPermissionsAsync();
      } catch {
        /* 무시 */
      }
    }
    const m = getMode(mode);
    if (m.consentNotice) {
      Alert.alert(`${m.emoji} ${m.label} 녹음`, m.consentNotice, [
        { text: '취소', style: 'cancel' },
        { text: '네, 시작', onPress: () => setScreen({ name: 'record', mode }) },
      ]);
    } else {
      setScreen({ name: 'record', mode });
    }
  };

  const handleSaved = async (item: RecordingItem) => {
    setRecordings(await addRecording(item));
    setScreen({ name: 'detail', id: item.id });
    const s = await loadSettings();
    if (s?.auto) {
      notify('드라이브로 보내는 중');
      setTimeout(refresh, 300);
      sendRecording(item.id)
        .then(() => notify('드라이브로 보냈어요 · 곧 받아쓰기를 시작해요'))
        .catch((e) => notify('드라이브 전송 실패: ' + (e as Error).message))
        .finally(refresh);
    }
  };

  const handleDelete = async (id: string) => {
    setRecordings(await removeRecording(id));
    setScreen({ name: 'home' });
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        {screen.name === 'home' && update && !updateHidden && (
          <View style={styles.banner}>
            <UpdateCard info={update} onDismiss={() => setUpdateHidden(true)} />
          </View>
        )}
        {screen.name === 'home' && (
          <HomeScreen
            selectedMode={mode}
            onSelectMode={selectMode}
            onStart={startRecording}
            recordings={recordings}
            onOpen={(item) => setScreen({ name: 'detail', id: item.id })}
            connected={connected}
            onSettings={() => setScreen({ name: 'settings' })}
            onImport={Platform.OS === 'android' ? () => setScreen({ name: 'share', text: '' }) : undefined}
          />
        )}
        {screen.name === 'share' && (
          <ShareScreen
            key={screen.text.slice(0, 40)}
            initialText={screen.text}
            metaTitle={screen.title}
            defaultMode={mode}
            connected={connected}
            onSettings={() => setScreen({ name: 'settings' })}
            onCancel={() => setScreen({ name: 'home' })}
            onDone={(msg) => {
              notify(msg);
              setScreen({ name: 'home' });
            }}
          />
        )}
        {screen.name === 'record' && (
          <RecordScreen
            modeId={screen.mode}
            onSaved={handleSaved}
            onCancel={() => setScreen({ name: 'home' })}
          />
        )}
        {screen.name === 'detail' &&
          (() => {
            // 저장소의 최신 상태로 보여주기 (백그라운드 전송 결과 반영)
            const item = recordings.find((r) => r.id === screen.id);
            return item ? (
              <DetailScreen
                key={item.id}
                item={item}
                onBack={() => setScreen({ name: 'home' })}
                onDelete={handleDelete}
                connected={connected}
                onSettings={() => setScreen({ name: 'settings' })}
                onChanged={refresh}
              />
            ) : null;
          })()}
        {screen.name === 'settings' && (
          <SettingsScreen
            onBack={() => {
              setScreen({ name: 'home' });
              syncNow();
            }}
            onSaved={() => {
              setScreen({ name: 'home' });
              notify('말씀노트 연결을 저장했어요');
              syncNow();
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  banner: { paddingHorizontal: 20, paddingTop: 12 },
});
