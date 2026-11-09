import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

// Firebase web config. These values identify the project to Google's servers and
// are designed to ship in client code; access is governed by Firebase rules,
// API restrictions and App Check — not by keeping this secret.
const firebaseConfig = {
  apiKey: 'AIzaSyBTwKSAZckHPg_aiIm2xuWpwIaNy5Lw9rY', // gitleaks:allow (public Firebase web key)
  authDomain: 'buildhybridai-2026-2bd49.firebaseapp.com',
  projectId: 'buildhybridai-2026-2bd49',
  storageBucket: 'buildhybridai-2026-2bd49.firebasestorage.app',
  messagingSenderId: '697505007197',
  appId: '1:697505007197:web:6338f5424a36540e7defb4',
};

export const firebaseApp = initializeApp(firebaseConfig);

// App Check protects the Gemini endpoint from abuse. Configure at build time:
//   VITE_RECAPTCHA_SITE_KEY      reCAPTCHA site key registered in Firebase App Check
//   VITE_RECAPTCHA_ENTERPRISE=1  use reCAPTCHA Enterprise instead of v3
//   VITE_APPCHECK_DEBUG_TOKEN    debug token for local development / CI only
const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
export let appCheckEnabled = false;
if (siteKey) {
  if (debugToken) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  initializeAppCheck(firebaseApp, {
    provider: import.meta.env.VITE_RECAPTCHA_ENTERPRISE ? new ReCaptchaEnterpriseProvider(siteKey) : new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  appCheckEnabled = true;
}

export const ai: AI = getAI(firebaseApp, { backend: new GoogleAIBackend() });
