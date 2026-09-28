/* global __APP_VERSION__ */
/**
 * Phase 34.5: the web app's version, injected at build / dev-server start by vite.config.js
 * (define: __APP_VERSION__ from package.json "version"). "dev" only if something bundles the app without Vite.
 * Bumping the version means editing frontend/package.json AND backend/src/version.py, then restarting
 * the frontend container (Vite reads package.json once, at start).
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
