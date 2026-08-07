import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../../context/AuthContext';
import AuthScreen from './AuthScreen';
import LoadingScreen from './LoadingScreen';
import SplashCarousel from './SplashCarousel';
import '../../styles/onboarding.css';

/* ------------------------------------------------------------------ */
/* Onboarding orchestrator. Strict flow:                              */
/*   Loading → Splash → Auth → Sign-in loading → App                  */
/*   Sign out → 0.5s loading → Auth                                   */
/* ------------------------------------------------------------------ */

type Stage = 'loading' | 'splash' | 'auth' | 'signing-in' | 'app';

const SEEN_SPLASH_KEY = 'tms_seen_splash';

export default function OnboardingFlow({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, signingOut, completeLogout } = useAuth();
  const isAuthenticated = !!user;

  const [stage, setStage] = useState<Stage>('loading');
  const [exiting, setExiting] = useState(false);
  const loadingDoneRef = useRef(false);
  const advancedRef = useRef(false);

  useLayoutEffect(() => {
    document.getElementById('app-splash')?.remove();
  }, []);

  const loggedOutInApp = stage === 'app' && !isAuthenticated && !signingOut;
  const inApp = stage === 'app' && isAuthenticated && !signingOut;

  useEffect(() => {
    if (inApp && !signingOut) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [inApp, signingOut]);

  const finishToApp = useCallback(() => {
    setExiting(true);
    window.setTimeout(() => setStage('app'), 480);
  }, []);

  const advanceFromLoading = useCallback(() => {
    if (advancedRef.current || authLoading || !loadingDoneRef.current) return;
    advancedRef.current = true;
    if (isAuthenticated) {
      finishToApp();
      return;
    }
    const seen = localStorage.getItem(SEEN_SPLASH_KEY) === '1';
    setStage(seen ? 'auth' : 'splash');
  }, [authLoading, isAuthenticated, finishToApp]);

  const handleLoadingDone = useCallback(() => {
    loadingDoneRef.current = true;
    advanceFromLoading();
  }, [advanceFromLoading]);

  useEffect(() => {
    advanceFromLoading();
  }, [advanceFromLoading]);

  const handleSplashDone = useCallback(() => {
    localStorage.setItem(SEEN_SPLASH_KEY, '1');
    setStage('auth');
  }, []);

  const handleAuthenticated = useCallback(() => {
    setExiting(false);
    setStage('signing-in');
  }, []);

  const handleSignInLoadingDone = useCallback(() => {
    setExiting(false);
    setStage('app');
  }, []);

  const handleSignOutLoadingDone = useCallback(() => {
    completeLogout();
    setExiting(false);
    setStage('auth');
  }, [completeLogout]);

  const renderStage = () => {
    if (signingOut) {
      return (
        <LoadingScreen
          onDone={handleSignOutLoadingDone}
          variant="signout"
          durationMs={500}
        />
      );
    }

    if (loggedOutInApp) {
      return <AuthScreen onAuthenticated={handleAuthenticated} />;
    }

    switch (stage) {
      case 'loading':
        return <LoadingScreen onDone={handleLoadingDone} variant="boot" />;
      case 'splash':
        return <SplashCarousel onDone={handleSplashDone} />;
      case 'auth':
        return <AuthScreen onAuthenticated={handleAuthenticated} />;
      case 'signing-in':
        return (
          <LoadingScreen
            onDone={handleSignInLoadingDone}
            variant="signin"
            durationMs={500}
          />
        );
      default:
        return null;
    }
  };

  const showExit = exiting && isAuthenticated && !signingOut;
  const showOverlay = !inApp || signingOut;

  return (
    <>
      {children}
      {showOverlay && (
        <div className={`ob-root ${showExit ? 'ob-exit' : ''}`} aria-hidden={showExit}>
          {renderStage()}
        </div>
      )}
    </>
  );
}
