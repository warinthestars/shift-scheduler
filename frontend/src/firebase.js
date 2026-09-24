import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  FacebookAuthProvider,
  TwitterAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
} from 'firebase/auth';
import api from './api/client';

const EMPTY_STATUS = {
  enabled: false,
  mock: false,
  config: null,
  providers: [],
  providers_source: 'none',
  self_registration: false,
};

/** Display metadata for OAuth providers. 'password' is handled by the email form. */
export const PROVIDER_META = {
  'google.com': { label: 'Google' },
  'microsoft.com': { label: 'Microsoft' },
  'apple.com': { label: 'Apple' },
  'github.com': { label: 'GitHub' },
  'facebook.com': { label: 'Facebook' },
  'twitter.com': { label: 'X (Twitter)' },
  'yahoo.com': { label: 'Yahoo' },
};

let statusPromise = null;

/** Returns the /auth/firebase-config payload merged over EMPTY_STATUS. Cached per page load. */
export function getFirebaseStatus() {
  if (!statusPromise) {
    statusPromise = api
      .get('/auth/firebase-config')
      .then((res) => ({ ...EMPTY_STATUS, ...(res.data || {}) }))
      .catch(() => ({ ...EMPTY_STATUS }));
  }
  return statusPromise;
}

async function getFirebaseAuth() {
  const status = await getFirebaseStatus();
  if (!status.enabled || !status.config) {
    throw new Error('Firebase sign-in is not configured on this server.');
  }
  const app = getApps().length ? getApps()[0] : initializeApp(status.config);
  return getAuth(app);
}

function buildProvider(providerId) {
  switch (providerId) {
    case 'google.com': {
      const p = new GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      return p;
    }
    case 'github.com':
      return new GithubAuthProvider();
    case 'facebook.com':
      return new FacebookAuthProvider();
    case 'twitter.com':
      return new TwitterAuthProvider();
    case 'microsoft.com':
    case 'apple.com':
    case 'yahoo.com':
      return new OAuthProvider(providerId);
    default:
      throw new Error(`Unsupported sign-in provider: ${providerId}`);
  }
}

/** Opens the provider popup and returns a Firebase ID token. */
export async function signInWithProviderId(providerId) {
  const auth = await getFirebaseAuth();
  const credential = await signInWithPopup(auth, buildProvider(providerId));
  return credential.user.getIdToken();
}

/** Backward-compatible alias used by AuthContext.loginWithFirebase. */
export async function signInWithGoogle() {
  return signInWithProviderId('google.com');
}

/** Email/password sign-in. Returns the Firebase user (caller checks emailVerified). */
export async function signInWithEmail(email, password) {
  const auth = await getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

/** Creates a Firebase email/password account, sets display name, sends verification email. */
export async function registerWithEmail({ email, password, firstName, lastName }) {
  const auth = await getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const displayName = `${firstName || ''} ${lastName || ''}`.trim();
  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }
  await sendEmailVerification(credential.user);
  return credential.user;
}

export async function resendVerificationEmail() {
  const auth = await getFirebaseAuth();
  if (!auth.currentUser) {
    throw new Error('Your session expired. Sign in with your email and password to resend the link.');
  }
  await sendEmailVerification(auth.currentUser);
}

/** Reloads the Firebase user; returns a fresh ID token if verified, otherwise throws. */
export async function completeEmailVerification() {
  const auth = await getFirebaseAuth();
  if (!auth.currentUser) {
    throw new Error('Your session expired. Sign in with your email and password.');
  }
  await auth.currentUser.reload();
  if (!auth.currentUser.emailVerified) {
    const err = new Error('Your email is not verified yet. Click the link in your inbox, then try again.');
    err.code = 'app/email-not-verified';
    throw err;
  }
  return auth.currentUser.getIdToken(true);
}

export async function sendPasswordReset(email) {
  const auth = await getFirebaseAuth();
  await sendPasswordResetEmail(auth, email);
}

/** Signs out of the Firebase browser session (ShiftBoard JWT is cleared separately). */
export async function firebaseSignOut() {
  if (!getApps().length) return;
  await signOut(getAuth(getApps()[0]));
}
