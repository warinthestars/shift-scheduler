/**
 * Phase 32: certificate types. Keys and labels match backend/src/services/fit.py CERT_TYPES.
 */
export const CERT_OPTIONS = [
  { key: 'alcohol_server', label: 'Alcohol server card', short: 'Alcohol server' },
  { key: 'food_handler', label: 'Food handler card', short: 'Food handler' },
  { key: 'food_manager', label: 'Food protection manager', short: 'Food manager' },
  { key: 'age_21', label: '21+ confirmed', short: '21+' },
  { key: 'security_license', label: 'Security guard license', short: 'Security license' },
  { key: 'first_aid', label: 'First aid / CPR', short: 'First aid' },
];

export const certShort = (key) => CERT_OPTIONS.find((c) => c.key === key)?.short || key;
