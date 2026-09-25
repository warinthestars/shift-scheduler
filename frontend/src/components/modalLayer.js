import { useEffect, useRef } from 'react';

/**
 * Phase 25.3: Shared behaviour for every overlay/modal.
 * - One body scroll-lock no matter how many modals are stacked.
 * - Esc closes ONLY the top-most modal.
 */
const stack = [];
let lockCount = 0;
let savedOverflow = '';

export function useModalLayer(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = Symbol('modal-layer');
    stack.push(id);

    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (stack[stack.length - 1] !== id) return;
      if (closeRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) document.body.style.overflow = savedOverflow;
    };
  }, []);
}
