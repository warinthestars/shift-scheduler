import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalLayer } from './modalLayer';

/**
 * One modal wrapper for the whole app (Phase 25.2, stacking-aware in 25.3).
 * The dark backdrop scrolls (not the panel), so long content always fits on any screen.
 * Header and footer are sticky inside the scrolling backdrop.
 */
export default function ModalShell({
  title,
  subtitle = null,
  icon = null,
  onClose,
  maxWidth = 'max-w-5xl',
  headerExtra = null,
  footer = null,
  children,
}) {
  useModalLayer(onClose);

  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-slate-950/85">
      <div className="min-h-full flex items-start justify-center p-2 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          className={`relative w-full ${maxWidth} bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl my-2 sm:my-6`}
        >
          <div className="sticky top-0 z-10 bg-slate-900 rounded-t-2xl border-b border-slate-800 px-4 sm:px-6 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {icon}
                  <span className="truncate">{title}</span>
                </h3>
                {subtitle && <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {headerExtra && <div className="mt-3">{headerExtra}</div>}
          </div>

          <div className="px-4 sm:px-6 py-4">{children}</div>

          {footer && (
            <div className="sticky bottom-0 z-10 bg-slate-900 rounded-b-2xl border-t border-slate-800 px-4 sm:px-6 py-3 flex flex-wrap justify-end gap-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
