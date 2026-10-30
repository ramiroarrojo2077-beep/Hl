import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.studyos.app',
  appName: 'StudyOS AI',
  webDir: 'dist',
  android: {
    // Permite que el WebView cargue la app y las llamadas nativas a Ollama en la red local.
    allowMixedContent: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_studyos',
      iconColor: '#5271FF',
    },
  },
};

export default config;
