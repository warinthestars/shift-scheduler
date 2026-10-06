import React from 'react';
import { APP_NAME, APP_TAGLINE } from '../brand';

/**
 * Phase 37: the ShiftUp logo. The pictures are in frontend/public/brand/ (made from assets/main_logo_shift-up.png).
 *   variant "bar"   the mark and the name side by side (headers)
 *   variant "stack" the mark above the name and the tagline (sign-in and invite pages)
 *   variant "mark"  the mark alone
 * className on "stack" sets its height (default h-40).
 * The name is a picture so it keeps the logo's lettering; the alt text carries it for screen readers.
 */
export default function BrandLogo({ variant = 'bar', className = '' }) {
  if (variant === 'mark') {
    return <img src="/brand/logo-mark.png" alt={APP_NAME} className={`w-9 h-9 object-contain ${className}`} />;
  }
  if (variant === 'stack') {
    return (
      <img src="/brand/logo-full.png" alt={`${APP_NAME} ${APP_TAGLINE}`} width="567" height="640"
        className={`w-auto object-contain mx-auto ${className || 'h-40'}`} />
    );
  }
  return (
    <span className={`inline-flex items-center gap-2.5 flex-shrink-0 ${className}`}>
      <img src="/brand/logo-mark.png" alt="" className="w-9 h-9 object-contain flex-shrink-0" />
      <img src="/brand/logo-wordmark.png" alt={APP_NAME} className="h-[1.35rem] w-auto object-contain flex-shrink-0" />
    </span>
  );
}
