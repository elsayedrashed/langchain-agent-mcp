'use client';
import { useEffect, useRef } from 'react';

function isInputElement(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA'].includes(element.nodeName);
}

function useFocusOnSlashPress() {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handleSlashKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !isInputElement(e.target)) {
        inputRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleSlashKeyDown);

    return () => document.removeEventListener('keydown', handleSlashKeyDown);
  }, []);

  return inputRef;
}

export default useFocusOnSlashPress;
