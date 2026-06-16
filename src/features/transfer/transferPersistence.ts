import type { TransferTask, TransferTaskStatus } from "./transferQueue";

const DB_NAME = "flaredrive-transfer";
const DB_VERSION = 2;
const TASK_STORE = "upload_tasks";
const FILE_STORE = "upload_task_files";
const UPLOAD_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface PersistedTransferTaskMeta {
  id: string;
  type: "upload";
  status: TransferTaskStatus;
  remoteKey: string;
  name: string;
  loaded: number;
  total: number;
  errorMessage?: string;
  multipart?: TransferTask["multipart"];
  createdAt: number;
  updatedAt: number;
}

interface PersistedTransferFile {
  id: string;
  blob: Blob;
  type: string;
  lastModified: number;
  name: string;
}

const TERMINAL_STATUSES: TransferTaskStatus[] = ["completed", "canceled"];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(TASK_STORE)) {
        db.createObjectStore(TASK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

function getAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []) as T[]);
    request.onerror = () => reject(request.error || new Error("IndexedDB getAll failed"));
  });
}

function put(store: IDBObjectStore, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("IndexedDB put failed"));
  });
}

function deleteByKey(store: IDBObjectStore, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("IndexedDB delete failed"));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

function isMetaExpired(meta: PersistedTransferTaskMeta, nowTs: number = Date.now()): boolean {
  const lastTouchedAt =
    Number.isFinite(meta.updatedAt) && meta.updatedAt > 0 ? meta.updatedAt : meta.createdAt;
  return nowTs - lastTouchedAt > UPLOAD_TASK_TTL_MS;
}

async function cleanupRecords(
  db: IDBDatabase,
  taskIds: Iterable<string>,
  fileIds: Iterable<string>
): Promise<void> {
  const taskIdList = [...new Set(taskIds)];
  const fileIdList = [...new Set(fileIds)];

  if (taskIdList.length === 0 && fileIdList.length === 0) return;

  const tx = db.transaction([TASK_STORE, FILE_STORE], "readwrite");
  const taskStore = tx.objectStore(TASK_STORE);
  const fileStore = tx.objectStore(FILE_STORE);

  for (const taskId of taskIdList) {
    await deleteByKey(taskStore, taskId);
  }
  for (const fileId of fileIdList) {
    await deleteByKey(fileStore, fileId);
  }

  await waitForTransaction(tx);
}

function serializeTaskMeta(task: TransferTask): PersistedTransferTaskMeta | null {
  if (task.type !== "upload") return null;
  if (TERMINAL_STATUSES.includes(task.status)) return null;
  if (!task.file) return null;

  return {
    id: task.id,
    type: "upload",
    status: task.status,
    remoteKey: task.remoteKey,
    name: task.name,
    loaded: task.loaded,
    total: task.total,
    errorMessage: task.error?.message,
    multipart: task.multipart,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function serializeTaskFile(task: TransferTask): PersistedTransferFile | null {
  if (task.type !== "upload") return null;
  if (TERMINAL_STATUSES.includes(task.status)) return null;
  if (!task.file) return null;

  return {
    id: task.id,
    blob: task.file,
    type: task.file.type,
    lastModified: task.file.lastModified,
    name: task.file.name,
  };
}

export async function loadPersistedUploadTasks(): Promise<TransferTask[]> {
  if (typeof indexedDB === "undefined") return [];

  try {
    const nowTs = Date.now();
    const db = await openDatabase();
    const tx = db.transaction([TASK_STORE, FILE_STORE], "readonly");
    const taskStore = tx.objectStore(TASK_STORE);
    const fileStore = tx.objectStore(FILE_STORE);

    const [metas, files] = await Promise.all([
      getAll<PersistedTransferTaskMeta>(taskStore),
      getAll<PersistedTransferFile>(fileStore),
    ]);
    await waitForTransaction(tx);

    const activeMetas = metas.filter((meta) => !isMetaExpired(meta, nowTs));
    const expiredMetaIds = metas.filter((meta) => isMetaExpired(meta, nowTs)).map((meta) => meta.id);
    const activeMetaIds = new Set(activeMetas.map((meta) => meta.id));
    const fileById = new Map(files.map((file) => [file.id, file]));
    const missingFileMetaIds = activeMetas
      .filter((meta) => !fileById.has(meta.id))
      .map((meta) => meta.id);
    const orphanFileIds = files
      .filter((file) => !activeMetaIds.has(file.id))
      .map((file) => file.id);

    await cleanupRecords(
      db,
      [...expiredMetaIds, ...missingFileMetaIds],
      [...expiredMetaIds, ...orphanFileIds]
    ).catch(() => {
      // Ignore cleanup failures so valid tasks can still be restored.
    });

    return activeMetas
      .map((meta) => {
        const fileRecord = fileById.get(meta.id);
        if (!fileRecord) return null;

        const file = new File([fileRecord.blob], fileRecord.name || meta.name, {
          type: fileRecord.type || "application/octet-stream",
          lastModified: fileRecord.lastModified || meta.updatedAt || Date.now(),
        });

        const status: TransferTaskStatus =
          meta.status === "in-progress" ? "pending" : meta.status;

        return {
          id: meta.id,
          type: "upload",
          status,
          remoteKey: meta.remoteKey,
          file,
          name: meta.name,
          loaded: meta.loaded,
          total: meta.total,
          error: meta.errorMessage ? new Error(meta.errorMessage) : undefined,
          multipart: meta.multipart,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        } satisfies TransferTask;
      })
      .filter((task) => task !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function persistUploadTasks(tasks: TransferTask[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  try {
    const nowTs = Date.now();
    const db = await openDatabase();
    const tx = db.transaction([TASK_STORE, FILE_STORE], "readwrite");
    const taskStore = tx.objectStore(TASK_STORE);
    const fileStore = tx.objectStore(FILE_STORE);

    const [existingMetas, existingFiles] = await Promise.all([
      getAll<PersistedTransferTaskMeta>(taskStore),
      getAll<PersistedTransferFile>(fileStore),
    ]);

    const nextMetas = tasks
      .map(serializeTaskMeta)
      .filter((meta): meta is PersistedTransferTaskMeta => meta !== null)
      .filter((meta) => !isMetaExpired(meta, nowTs));
    const nextIds = new Set(nextMetas.map((meta) => meta.id));
    const nextFiles = tasks
      .map(serializeTaskFile)
      .filter((file): file is PersistedTransferFile => file !== null)
      .filter((file) => nextIds.has(file.id));

    const existingMetaIds = new Set(existingMetas.map((meta) => meta.id));
    const existingFileIds = new Set(existingFiles.map((file) => file.id));

    for (const meta of nextMetas) {
      await put(taskStore, meta);
    }

    for (const file of nextFiles) {
      if (existingFileIds.has(file.id)) continue;
      await put(fileStore, file);
    }

    for (const staleId of existingMetaIds) {
      if (nextIds.has(staleId)) continue;
      await deleteByKey(taskStore, staleId);
    }

    for (const staleId of existingFileIds) {
      if (nextIds.has(staleId)) continue;
      await deleteByKey(fileStore, staleId);
    }

    await waitForTransaction(tx);
  } catch {
    // Ignore persistence failures: uploads should still continue in-memory.
  }
}
