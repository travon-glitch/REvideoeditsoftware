"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const LIMIT = 100;

export interface History<T> {
  value: T;
  /** Record a change (undoable). Changes within `mergeMs` of each other with the same key merge into one step (e.g. typing). */
  set: (next: T | ((prev: T) => T), mergeKey?: string) => void;
  /** Replace the value without an undo step (e.g. data loaded from the server). */
  reset: (next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Undo / redo for any value. Ctrl+Z (⌘Z) undoes, Ctrl+Shift+Z or Ctrl+Y redoes —
 * except while typing in a text box, where the browser's own undo applies.
 */
export function useHistory<T>(initial: T, { mergeMs = 1000, keyboard = true } = {}): History<T> {
  const [state, setState] = useState({ past: [] as T[], value: initial, future: [] as T[] });
  const lastMerge = useRef<{ key: string; at: number } | null>(null);

  const set = useCallback((next: T | ((prev: T) => T), mergeKey?: string) => {
    setState((s) => {
      const value = typeof next === "function" ? (next as (p: T) => T)(s.value) : next;
      if (Object.is(value, s.value)) return s;
      const now = Date.now();
      const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < mergeMs;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      if (merge) return { ...s, value, future: [] };
      return { past: [...s.past, s.value].slice(-LIMIT), value, future: [] };
    });
  }, [mergeMs]);

  const reset = useCallback((value: T) => { lastMerge.current = null; setState({ past: [], value, future: [] }); }, []);

  const undo = useCallback(() => {
    lastMerge.current = null;
    setState((s) => (s.past.length === 0 ? s : {
      past: s.past.slice(0, -1), value: s.past[s.past.length - 1]!, future: [s.value, ...s.future],
    }));
  }, []);

  const redo = useCallback(() => {
    lastMerge.current = null;
    setState((s) => (s.future.length === 0 ? s : {
      past: [...s.past, s.value], value: s.future[0]!, future: s.future.slice(1),
    }));
  }, []);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "range", "button"].includes((el as HTMLInputElement).type)))) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, undo, redo]);

  return { value: state.value, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
