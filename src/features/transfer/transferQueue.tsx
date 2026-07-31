import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { isAbortError, processTransferTask } from "./transfer";
import { loadPersistedUploadTasks, persistUploadTasks } from "./transferPersistence";

export type TransferTaskType = "upload" | "download";
export type TransferTaskStatus =
  | "pending"
  | "in-progress"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export interface MultipartUploadCheckpoint {
  uploadId: string;
  uploadedParts: Record<number, string>;
}

export interface TransferTask {
  id: string;
  type: TransferTaskType;
  status: TransferTaskStatus;
  remoteKey: string;
  file?: File;
  name: string;
  loaded: number;
  total: number;
  error?: Error;
  multipart?: MultipartUploadCheckpoint;
  createdAt: number;
  updatedAt: number;
}

type TransferQueueControls = {
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  clearFinished: () => void;
};

const DEFAULT_MAX_CONCURRENT_UPLOADS = 3;
const MIN_MAX_CONCURRENT_UPLOADS = 1;
const MAX_MAX_CONCURRENT_UPLOADS = 4;

const TransferQueueContext = createContext<TransferTask[]>([]);
const TransferQueueControlsContext = createContext<TransferQueueControls>({
  pauseTask: () => {},
  resumeTask: () => {},
  cancelTask: () => {},
  retryTask: () => {},
  clearFinished: () => {},
});
const SetTransferQueueContext = createContext<
  React.Dispatch<React.SetStateAction<TransferTask[]>>
>(() => {});

function now() {
  return Date.now();
}

function createTaskId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isUploadTaskActive(task: TransferTask) {
  return task.type === "upload" && ["pending", "in-progress", "paused"].includes(task.status);
}

function getAbortReason(error: unknown, signal: AbortSignal): unknown {
  if (signal.aborted) return signal.reason;
  if (isAbortError(error) && "reason" in error) return (error as any).reason;
  return undefined;
}

function normalizeMaxConcurrentUploads(value: number) {
  return Math.min(
    MAX_MAX_CONCURRENT_UPLOADS,
    Math.max(MIN_MAX_CONCURRENT_UPLOADS, Math.floor(value || DEFAULT_MAX_CONCURRENT_UPLOADS))
  );
}

function computeAutoMaxConcurrentUploads() {
  if (typeof navigator === "undefined") {
    return DEFAULT_MAX_CONCURRENT_UPLOADS;
  }

  const hardwareThreads =
    typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : DEFAULT_MAX_CONCURRENT_UPLOADS;

  if (hardwareThreads <= 2) return 1;
  if (hardwareThreads <= 4) return 2;
  if (hardwareThreads <= 8) return 3;
  return 4;
}

function updateTaskById(
  tasks: TransferTask[],
  taskId: string,
  updater: (task: TransferTask) => TransferTask
): TransferTask[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    return { ...updater(task), updatedAt: now() };
  });
}

export function useTransferQueue() {
  return useContext(TransferQueueContext);
}

export function useTransferQueueControls() {
  return useContext(TransferQueueControlsContext);
}

export function useUploadEnqueue() {
  const setTransferTasks = useContext(SetTransferQueueContext);

  return (...requests: { basedir: string; file: File }[]) => {
    const createdAt = now();
    const newTasks = requests.map(
      ({ basedir, file }) =>
        ({
          id: createTaskId(),
          type: "upload",
          status: "pending",
          name: file.name,
          file,
          remoteKey: basedir + file.name,
          loaded: 0,
          total: file.size,
          createdAt,
          updatedAt: createdAt,
        } satisfies TransferTask)
    );
    setTransferTasks((tasks) => [...tasks, ...newTasks]);
  };
}

export function TransferQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const [maxConcurrentUploads] = useState(() =>
    normalizeMaxConcurrentUploads(computeAutoMaxConcurrentUploads())
  );
  const [hydrated, setHydrated] = useState(false);

  const runningControllersRef = useRef(new Map<string, AbortController>());
  const requestedAbortReasonRef = useRef(new Map<string, "pause" | "cancel">());
  const transferTasksRef = useRef<TransferTask[]>(transferTasks);

  useEffect(() => {
    transferTasksRef.current = transferTasks;
  }, [transferTasks]);

  const [persistenceVersion, setPersistenceVersion] = useState(0);

  useEffect(() => {
    setPersistenceVersion((v) => (v + 1) % 1_000_000);
  }, [transferTasks]);

  useEffect(() => {
    let canceled = false;

    loadPersistedUploadTasks()
      .then((persistedTasks) => {
        if (canceled || persistedTasks.length === 0) return;
        setTransferTasks((existingTasks) => {
          const existingTaskIds = new Set(existingTasks.map((task) => task.id));
          const merged = [...existingTasks];
          for (const task of persistedTasks) {
            if (!existingTaskIds.has(task.id)) merged.push(task);
          }
          return merged;
        });
      })
      .finally(() => {
        if (!canceled) setHydrated(true);
      });

    return () => {
      canceled = true;
      for (const controller of runningControllersRef.current.values()) {
        controller.abort("cancel");
      }
      runningControllersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      void persistUploadTasks(transferTasksRef.current);
    }, 300);

    return () => clearTimeout(timer);
  }, [hydrated, persistenceVersion]);

  const startTask = useCallback((taskId: string) => {
    if (runningControllersRef.current.has(taskId)) return;

    const task = transferTasksRef.current.find((item) => item.id === taskId);
    if (!task || task.type !== "upload") return;
    if (!["pending", "paused"].includes(task.status)) return;

    const controller = new AbortController();
    runningControllersRef.current.set(taskId, controller);

    setTransferTasks((tasks) =>
      updateTaskById(tasks, taskId, (currentTask) => ({
        ...currentTask,
        status: "in-progress",
        error: undefined,
      }))
    );

    void processTransferTask({
      task,
      signal: controller.signal,
      onTaskProgress: ({ loaded, total }) => {
        setTransferTasks((tasks) =>
          updateTaskById(tasks, taskId, (currentTask) => ({
            ...currentTask,
            // Keep progress monotonic in UI to avoid visible rollback
            // when a multipart part is retried after pause/resume.
            loaded: Math.min(total, Math.max(currentTask.loaded, loaded)),
            total,
          }))
        );
      },
      onCheckpoint: (checkpoint) => {
        setTransferTasks((tasks) =>
          updateTaskById(tasks, taskId, (currentTask) => ({
            ...currentTask,
            multipart: checkpoint,
          }))
        );
      },
    })
      .then(() => {
        setTransferTasks((tasks) =>
          updateTaskById(tasks, taskId, (currentTask) => ({
            ...currentTask,
            status: "completed",
            loaded: currentTask.total,
            error: undefined,
            multipart: undefined,
          }))
        );
      })
      .catch((error: unknown) => {
        const requestedReason = requestedAbortReasonRef.current.get(taskId);
        const reason = getAbortReason(error, controller.signal);

        if (requestedReason === "cancel" || reason === "cancel") {
          setTransferTasks((tasks) =>
            updateTaskById(tasks, taskId, (currentTask) => ({
              ...currentTask,
              status: "canceled",
              error: undefined,
              multipart: undefined,
            }))
          );
          return;
        }

        if (requestedReason === "pause" || reason === "pause" || isAbortError(error)) {
          setTransferTasks((tasks) =>
            updateTaskById(tasks, taskId, (currentTask) => {
              // Ignore stale pause result if user already resumed.
              if (currentTask.status === "pending") return currentTask;
              return {
                ...currentTask,
                status: "paused",
                error: undefined,
              };
            })
          );
          return;
        }

        const normalizedError =
          error instanceof Error ? error : new Error("Upload failed");

        setTransferTasks((tasks) =>
          updateTaskById(tasks, taskId, (currentTask) => ({
            ...currentTask,
            status: "failed",
            error: normalizedError,
          }))
        );
      })
      .finally(() => {
        runningControllersRef.current.delete(taskId);
        requestedAbortReasonRef.current.delete(taskId);
      });
  }, []);

  const schedulePendingTasks = useCallback(() => {
    if (!hydrated) return;

    const currentlyRunning = runningControllersRef.current.size;
    const availableSlots = maxConcurrentUploads - currentlyRunning;
    if (availableSlots <= 0) return;

    const pendingTaskIds = transferTasksRef.current
      .filter((task) => task.type === "upload" && task.status === "pending")
      .map((task) => task.id)
      .slice(0, availableSlots);

    for (const taskId of pendingTaskIds) {
      startTask(taskId);
    }
  }, [hydrated, maxConcurrentUploads, startTask]);

  useEffect(() => {
    schedulePendingTasks();
  }, [schedulePendingTasks, transferTasks, maxConcurrentUploads]);

  const pauseTask = useCallback((taskId: string) => {
    const running = runningControllersRef.current.get(taskId);
    if (running) {
      requestedAbortReasonRef.current.set(taskId, "pause");
      running.abort("pause");
      return;
    }

    setTransferTasks((tasks) =>
      updateTaskById(tasks, taskId, (task) => {
        if (task.status !== "pending") return task;
        return { ...task, status: "paused" };
      })
    );
  }, []);

  const resumeTask = useCallback((taskId: string) => {
    requestedAbortReasonRef.current.delete(taskId);
    setTransferTasks((tasks) =>
      updateTaskById(tasks, taskId, (task) => {
        if (!["paused", "failed"].includes(task.status)) return task;
        const canResumeFromCheckpoint = Boolean(task.multipart);
        return {
          ...task,
          status: "pending",
          error: undefined,
          loaded: canResumeFromCheckpoint ? task.loaded : 0,
        };
      })
    );
  }, []);

  const cancelTask = useCallback((taskId: string) => {
    const running = runningControllersRef.current.get(taskId);
    if (running) {
      requestedAbortReasonRef.current.set(taskId, "cancel");
      running.abort("cancel");
      return;
    }

    setTransferTasks((tasks) =>
      updateTaskById(tasks, taskId, (task) => ({
        ...task,
        status: "canceled",
        error: undefined,
        multipart: undefined,
      }))
    );
  }, []);

  const retryTask = useCallback((taskId: string) => {
    requestedAbortReasonRef.current.delete(taskId);
    setTransferTasks((tasks) =>
      updateTaskById(tasks, taskId, (task) => {
        if (task.status !== "failed") return task;
        const canResumeFromCheckpoint = Boolean(task.multipart);
        return {
          ...task,
          status: "pending",
          error: undefined,
          loaded: canResumeFromCheckpoint ? task.loaded : 0,
        };
      })
    );
  }, []);

  const clearFinished = useCallback(() => {
    setTransferTasks((tasks) =>
      tasks.filter((task) => !["completed", "canceled"].includes(task.status))
    );
  }, []);

  const controls = useMemo<TransferQueueControls>(
    () => ({
      pauseTask,
      resumeTask,
      cancelTask,
      retryTask,
      clearFinished,
    }),
    [cancelTask, clearFinished, pauseTask, resumeTask, retryTask]
  );

  const activeUploads = useMemo(
    () => transferTasks.filter(isUploadTaskActive).length,
    [transferTasks]
  );

  useEffect(() => {
    if (!hydrated) return;
    if (activeUploads === 0) {
      void persistUploadTasks(transferTasksRef.current);
    }
  }, [activeUploads, hydrated]);

  return (
    <TransferQueueContext.Provider value={transferTasks}>
      <TransferQueueControlsContext.Provider value={controls}>
        <SetTransferQueueContext.Provider value={setTransferTasks}>
          {children}
        </SetTransferQueueContext.Provider>
      </TransferQueueControlsContext.Provider>
    </TransferQueueContext.Provider>
  );
}
