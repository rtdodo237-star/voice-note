// 앱 진입점 — 권한 요청, 오디오 설정, 화면 전환
import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet } from 'react-native';
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
  | { name: 'detail'; item: RecordingItem };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [mode, setMode] = useState<ModeId>('consult');
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);

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
    setScreen({ name: 'detail', item });
  };

  const handleDelete = async (id: string) => {
    setRecordings(await removeRecording(id));
    setScreen({ name: 'home' });
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        {screen.name === 'home' && (
          <HomeScreen
            selectedMode={mode}
            onSelectMode={selectMode}
            onStart={startRecording}
            recordings={recordings}
            onOpen={(item) => setScreen({ name: 'detail', item })}
          />
        )}
        {screen.name === 'record' && (
          <RecordScreen
            modeId={screen.mode}
            onSaved={handleSaved}
            onCancel={() => setScreen({ name: 'home' })}
          />
        )}
        {screen.name === 'detail' && (
          <DetailScreen
            item={screen.item}
            onBack={() => setScreen({ name: 'home' })}
            onDelete={handleDelete}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
});
