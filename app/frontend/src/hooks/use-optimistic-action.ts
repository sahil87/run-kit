import { useState, useRef, useCallback, useEffect } from "react";

type UseOptimisticActionOptions<TArgs extends unknown[] = []> = {
  action: (...args: TArgs) => Promise<unknown>;
  onOptimistic?: (...args: TArgs) => void;
  onRollback?: () => void;
  onSettled?: () => void;
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
    const { action, onOptimistic, onRollback, onSettled, onError } = optionsRef.current;

    onOptimistic?.(...args);
    setIsPending(true);

    Promise.resolve()
      .then(() => action(...args))
      .then(
        () => {
          if (!mountedRef.current) return;
          onSettled?.();
          setIsPending(false);
        },
        (err: unknown) => {
          if (!mountedRef.current) return;
          onRollback?.();
          const error = err instanceof Error ? err : new Error(String(err));
          onError?.(error);
          setIsPending(false);
        },
      );
  }, []);

  return { execute, isPending };
}
