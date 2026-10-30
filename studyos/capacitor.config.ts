import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.studyos.app',
  appName: 'StudyOS AI',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#060913',
  },
  backgroundColor: '#060913',
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_studyos',
      iconColor: '#5271FF',
    },
  },
};

export default config;
