"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 60 * 1000; // 1 minute

interface SyncProgress {
  current: number;
  total: number;
  status: string;
}

interface SyncContextType {
  isSyncing: boolean;
  progress: SyncProgress | null;
  progressText: string | null;
  isError: boolean;
  isAutoSyncEnabled: boolean;
  setAutoSyncEnabled: (enabled: boolean) => void;
  triggerSync: () => void;
}

const SyncContext = createContext<SyncContextType | null>(null);

export function useSyncContext() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSyncContext must be used within a SyncProvider");
  }
  return context;
}

const AUTO_SYNC_STORAGE_KEY = "email-sorter-auto-sync";

export function SyncProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState(false);
  const [isAutoSyncInitialized, setIsAutoSyncInitialized] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncEndRef = useRef<number>(0);

  // Load auto-sync preference from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    if (stored === "true") {
      setIsAutoSyncEnabled(true);
    }
    setIsAutoSyncInitialized(true);
  }, []);

  // Save auto-sync preference to localStorage when it changes
  useEffect(() => {
    if (isAutoSyncInitialized) {
      localStorage.setItem(AUTO_SYNC_STORAGE_KEY, String(isAutoSyncEnabled));
    }
  }, [isAutoSyncEnabled, isAutoSyncInitialized]);

  const performSync = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setProgress(null);
    setProgressText("Fetching emails...");
    setIsError(false);

    try {
      const response = await fetch("/api/gmail/sync", { method: "POST" });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.type === "fetching") {
              setProgressText("Fetching emails...");
            } else if (data.type === "start") {
              setProgress({ current: 0, total: data.total, status: "syncing" });
              setProgressText(`0/${data.total} processed`);
            } else if (data.type === "progress") {
              setProgress({
                current: data.current,
                total: data.total,
                status: "syncing",
              });
              setProgressText(`${data.current}/${data.total} processed`);
            } else if (data.type === "complete") {
              const parts = [];
              if (data.totalProcessed > 0)
                parts.push(`${data.totalProcessed} new`);
              if (data.totalSkipped > 0)
                parts.push(`${data.totalSkipped} skipped`);
              if (data.totalErrors > 0)
                parts.push(`${data.totalErrors} errors`);
              setProgressText(
                parts.length > 0
                  ? `Done! ${parts.join(", ")}`
                  : "Done! No new emails"
              );
              setProgress(null);
              setIsError(false);
              // Clear progress text after 10 seconds
              setTimeout(() => {
                setProgressText(null);
              }, 10000);
            } else if (data.type === "error") {
              setProgressText(data.message);
              setProgress(null);
              setIsError(true);
              // Clear error text after 10 seconds
              setTimeout(() => {
                setProgressText(null);
                setIsError(false);
              }, 10000);
            }
          }
        }
      }

      router.refresh();
    } catch (error) {
      setProgressText(`Error: ${error}`);
      setProgress(null);
      setIsError(true);
    } finally {
      setIsSyncing(false);
      lastSyncEndRef.current = Date.now();
    }
  }, [isSyncing, router]);

  const scheduleNextSync = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isAutoSyncEnabled || isSyncing) return;

    const timeSinceLastSync = Date.now() - lastSyncEndRef.current;
    const timeToWait = Math.max(0, POLL_INTERVAL_MS - timeSinceLastSync);

    timerRef.current = setTimeout(() => {
      performSync();
    }, timeToWait);
  }, [isAutoSyncEnabled, isSyncing, performSync]);

  // Handle auto-sync toggle - only trigger when user toggles or on initial load
  useEffect(() => {
    if (!isAutoSyncInitialized) return;

    if (isAutoSyncEnabled && !isSyncing) {
      performSync();
    } else if (!isAutoSyncEnabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoSyncEnabled, isAutoSyncInitialized]);

  // Schedule next sync after current sync completes
  useEffect(() => {
    if (!isSyncing && isAutoSyncEnabled) {
      scheduleNextSync();
    }
  }, [isSyncing, isAutoSyncEnabled, scheduleNextSync]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const triggerSync = useCallback(() => {
    if (!isSyncing) {
      // Reset the last sync time so auto-sync waits full minute after manual sync
      lastSyncEndRef.current = 0;
      performSync();
    }
  }, [isSyncing, performSync]);

  return (
    <SyncContext.Provider
      value={{
        isSyncing,
        progress,
        progressText,
        isError,
        isAutoSyncEnabled,
        setAutoSyncEnabled: setIsAutoSyncEnabled,
        triggerSync,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}
