import React from 'react';
import { createPortal } from 'react-dom';
import ShiftBoard from './ShiftBoard';
import { useModalLayer } from './modalLayer';

/**
 * Phase 25.3: Discussion board overlay. Always renders above ModalShell (z-[60]).
 */
export default function ShiftBoardModal({ shiftId, shiftTitle, currentUserRole, onClose }) {
  useModalLayer(onClose);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-slate-950/85 flex items-center justify-center p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="max-w-2xl w-full">
        <ShiftBoard shiftId={shiftId} shiftTitle={shiftTitle} currentUserRole={currentUserRole} onClose={onClose} />
      </div>
    </div>,
    document.body
  );
}
