import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui';
import { useSettings } from './stores/settings';
import { requestPersistentStorage } from './lib/db';
import { isNative } from './lib/platform';
import { LockScreen } from './features/onboarding/LockScreen';
import { Onboarding } from './features/onboarding/Onboarding';
import { Dashboard } from './features/dashboard/Dashboard';

const SubjectsPage = lazy(() => import('./features/subjects/SubjectsPage'));
const SubjectDetail = lazy(() => import('./features/subjects/SubjectDetail'));
const LibraryPage = lazy(() => import('./features/library/LibraryPage'));
const DocumentView = lazy(() => import('./features/library/DocumentView'));
const SummaryView = lazy(() => import('./features/summaries/SummaryView'));
const TutorPage = lazy(() => import('./features/tutor/TutorPage'));
const TasksPage = lazy(() => import('./features/tasks/TasksPage'));
const TaskSolve = lazy(() => import('./features/tasks/TaskSolve'));
const ExamsPage = lazy(() => import('./features/exams/ExamsPage'));
const ExamTake = lazy(() => import('./features/exams/ExamTake'));
const FlashcardsPage = lazy(() => import('./features/flashcards/FlashcardsPage'));
const DeckPage = lazy(() => import('./features/flashcards/DeckPage'));
const CalendarPage = lazy(() => import('./features/calendar/CalendarPage'));
const StatsPage = lazy(() => import('./features/stats/StatsPage'));
const LabPage = lazy(() => import('./features/lab/LabPage'));
const VideoStudio = lazy(() => import('./features/video/VideoStudio'));
const BoardPage = lazy(() => import('./features/board/BoardPage'));
const MapsPage = lazy(() => import('./features/maps/MapsPage'));
const MapEditor = lazy(() => import('./features/maps/MapEditor'));
const FocusPage = lazy(() => import('./features/focus/FocusPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));

function Loading() {
  return (
    <div className="grid place-items-center py-24">
      <Spinner className="size-6" />
    </div>
  );
}

function BackButtonHandler() {
  const nav = useNavigate();
  useEffect(() => {
    if (!isNative) return;
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) => {
      CapApp.addListener('backButton', ({ canGoBack }) => {
        // Primero cierra lo que esté abierto encima (diálogos, hojas, pantalla completa)
        if (document.querySelector('[role="dialog"], [data-overlay]')) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          return;
        }
        if (canGoBack && window.location.hash !== '#/') nav(-1);
        else CapApp.minimizeApp();
      }).then((h) => (remove = () => h.remove()));
    });
    return () => remove?.();
  }, [nav]);
  return null;
}

function Gate({ children }: { children: ReactNode }) {
  const { loaded, load, s } = useSettings();
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    load();
    requestPersistentStorage();
  }, [load]);
  if (!loaded) return <Loading />;
  if (s.security.pinHash && !unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return (
    <>
      {children}
      {!s.onboarded && <Onboarding />}
    </>
  );
}

export function App() {
  const reduce = useSettings((s) => s.s.ui.reduceMotion);
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>
      <HashRouter>
        <Gate>
          <BackButtonHandler />
          <AppShell>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/subjects" element={<SubjectsPage />} />
                <Route path="/subjects/:id" element={<SubjectDetail />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/library/:id" element={<DocumentView />} />
                <Route path="/summaries/:id" element={<SummaryView />} />
                <Route path="/tutor" element={<TutorPage />} />
                <Route path="/tutor/:sessionId" element={<TutorPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/tasks/:id" element={<TaskSolve />} />
                <Route path="/exams" element={<ExamsPage />} />
                <Route path="/exams/:id" element={<ExamTake />} />
                <Route path="/flashcards" element={<FlashcardsPage />} />
                <Route path="/flashcards/:id" element={<DeckPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/lab" element={<LabPage />} />
                <Route path="/video" element={<VideoStudio />} />
                <Route path="/board" element={<BoardPage />} />
                <Route path="/maps" element={<MapsPage />} />
                <Route path="/maps/:id" element={<MapEditor />} />
                <Route path="/focus" element={<FocusPage />} />
                <Route path="/focus/session" element={<FocusPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Dashboard />} />
              </Routes>
            </Suspense>
          </AppShell>
        </Gate>
      </HashRouter>
    </MotionConfig>
  );
}
