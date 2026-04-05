import { useState, useRef, useCallback, useEffect } from "react";

type UseOptimisticActionOptions<TArgs extends unknown[] = []> = {
  action: (...args: TArgs) => Promise<unknown>;
  onOptimistic?: (...args: TArgs) => void;
  /** Called on success regardless of mount state. Must be safe to call after unmount (e.g., only interacts with root-level context). */
  onAlwaysSettled?: () => void;
  /** Called on failure regardless of mount state. Must be safe to call after unmount (e.g., only interacts with root-level context). */
  onAlwaysRollback?: () => void;
  /** Called on success only if still mounted. Safe to use with local component state. */
  onSettled?: () => void;
  /** Called on failure only if still mounted. Safe to use with local component state. */
  onRollback?: () => void;
  onError?: (error: Error) => void;
};

type UseOptimisticActionReturn<TArgs extends unknown[] = []> = {
  execute: (...args: TArgs) => void;
  isPending: boolean;
};

export function useOptimisticAction<TArgs extends unknown[] = []>(
  options: UseOptimisticActionOptions<TArgs>,
): UseOptimisticActionReturn<TArgs> {
  const [isPending, setIsPending] = useState(false);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback((...args: TArgs) => {
    const { action, onOptimistic, onAlwaysSettled, onAlwaysRollback, onRollback, onSettled, onError } = optionsRef.current;

    onOptimistic?.(...args);
    setIsPending(true);

    Promise.resolve()
      .then(() => action(...args))
      .then(
        () => {
          onAlwaysSettled?.();              // always runs (for global context cleanup)
          if (!mountedRef.current) return;
          onSettled?.();                    // guarded (may update local component state)
          setIsPending(false);
        },
        (err: unknown) => {
          onAlwaysRollback?.();             // always runs (for global context cleanup)
          if (!mountedRef.current) return;
          onRollback?.();                   // guarded (may update local component state)
          const error = err instanceof Error ? err : new Error(String(err));
          onError?.(error);
          setIsPending(false);
        },
      );
  }, []);

  return { execute, isPending };
}
