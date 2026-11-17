import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
  credits: number;
  plan: string;
  isDemo: boolean;
  preferences: {
    defaultAspectRatio?: '9:16' | '1:1' | '16:9';
    defaultCaptionStyle?: 'Minimal' | 'Animated' | 'Bold' | 'Karaoke' | 'Modern';
    defaultResolution?: '720p' | '1080p';
  };
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  token: string | null;
  loading: boolean;
  isDemoSession: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string, mode: 'login' | 'signup') => Promise<void>;
  startDemoSession: () => Promise<string>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  getValidToken: () => Promise<string | null>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemoSession, setIsDemoSession] = useState(false);

  const fetchProfileWithToken = useCallback(async (activeToken: string) => {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${activeToken}` },
    });
    if (!res.ok) {
      throw new Error('Failed to load profile');
    }
    const data = (await res.json()) as UserProfile;
    setProfile(data);
    return data;
  }, []);

  const startDemoSession = useCallback(async (): Promise<string> => {
    const res = await fetch('/api/auth/demo-session', { method: 'POST' });
    if (!res.ok) {
      throw new Error('Unable to start studio session.');
    }
    const data = (await res.json()) as { token: string };
    setToken(data.token);
    setIsDemoSession(true);
    sessionStorage.setItem('clipgenius_demo_token', data.token);
    await fetchProfileWithToken(data.token);
    return data.token;
  }, [fetchProfileWithToken]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const idToken = await user.getIdToken();
          setToken(idToken);
          setIsDemoSession(false);
          sessionStorage.removeItem('clipgenius_demo_token');
          await fetchProfileWithToken(idToken);
        } catch (err) {
          console.error('Failed to sync Firebase user:', err);
        } finally {
          setLoading(false);
        }
      } else {
        const storedDemo = sessionStorage.getItem('clipgenius_demo_token');
        if (storedDemo) {
          try {
            setToken(storedDemo);
            setIsDemoSession(true);
            await fetchProfileWithToken(storedDemo);
          } catch {
            sessionStorage.removeItem('clipgenius_demo_token');
            setToken(null);
            setProfile(null);
            setIsDemoSession(false);
          }
        } else {
          setToken(null);
          setProfile(null);
          setIsDemoSession(false);
        }
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [fetchProfileWithToken]);

  const signInWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    setToken(idToken);
    setIsDemoSession(false);
    sessionStorage.removeItem('clipgenius_demo_token');
    await fetchProfileWithToken(idToken);
  }, [fetchProfileWithToken]);

  const signInWithEmail = useCallback(
    async (email: string, password: string, mode: 'login' | 'signup') => {
      try {
        const cred =
          mode === 'signup'
            ? await createUserWithEmailAndPassword(auth, email, password)
            : await signInWithEmailAndPassword(auth, email, password);
        const idToken = await cred.user.getIdToken();
        setToken(idToken);
        setIsDemoSession(false);
        await fetchProfileWithToken(idToken);
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code ?? '';
        if (code === 'auth/operation-not-allowed') {
          throw new Error(
            'Email/Password sign-in is not enabled in Firebase Console yet. Use Google Sign-In or Continue in Studio Workspace.'
          );
        }
        throw err;
      }
    },
    [fetchProfileWithToken]
  );

  const logout = useCallback(async () => {
    sessionStorage.removeItem('clipgenius_demo_token');
    if (firebaseUser) {
      await signOut(auth);
    }
    setToken(null);
    setProfile(null);
    setIsDemoSession(false);
  }, [firebaseUser]);

  const refreshProfile = useCallback(async () => {
    if (firebaseUser) {
      const fresh = await firebaseUser.getIdToken();
      setToken(fresh);
      await fetchProfileWithToken(fresh);
    } else if (token) {
      await fetchProfileWithToken(token);
    }
  }, [firebaseUser, token, fetchProfileWithToken]);

  const getValidToken = useCallback(async (): Promise<string | null> => {
    let activeToken = token;
    if (firebaseUser) {
      activeToken = await firebaseUser.getIdToken();
      setToken(activeToken);
    } else if (!activeToken) {
      activeToken = await startDemoSession();
    }
    return activeToken;
  }, [firebaseUser, token, startDemoSession]);

  const authFetch = useCallback(
    async (input: string, init: RequestInit = {}) => {
      const activeToken = await getValidToken();

      const headers = new Headers(init.headers || {});
      if (activeToken) {
        headers.set('Authorization', `Bearer ${activeToken}`);
      }
      return fetch(input, { ...init, headers });
    },
    [getValidToken]
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        token,
        loading,
        isDemoSession,
        signInWithGoogle,
        signInWithEmail,
        startDemoSession,
        logout,
        refreshProfile,
        getValidToken,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
