// Main.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Breadcrumbs,
  Button,
  CircularProgress,
  Link,
  Typography,
} from "@mui/material";
import { Home as HomeIcon, NoteAdd as NoteAddIcon } from "@mui/icons-material";

import FileGrid, { FileItem, isDirectory } from "./FileGrid";
import MultiSelectToolbar from "./MultiSelectToolbar";
import UploadDrawer, { UploadFab } from "./UploadDrawer";
import TextPadDrawer from "./TextPadDrawer";
import {
  copyPaste,
  deletePath,
  downloadFile,
  fetchPath,
} from "../features/transfer/transfer";
import {
  useTransferQueue,
  useUploadEnqueue,
} from "../features/transfer/transferQueue";
import {
  systemShare,
  createShareLink,
  getShareStatus,
} from "../features/share/share";

// Centered helper
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
      }}
    >
      {children}
    </Box>
  );
}

// Breadcrumb component
function PathBreadcrumb({
  path,
  onCwdChange,
}: {
  path: string;
  onCwdChange: (newCwd: string) => void;
}) {
  const parts = path.replace(/\/$/, "").split("/");

  return (
    <Breadcrumbs separator="›" sx={{ padding: 1 }}>
      <Button onClick={() => onCwdChange("")} sx={{ minWidth: 0, padding: 0 }}>
        <HomeIcon />
      </Button>
      {parts.map((part, index) =>
        index === parts.length - 1 ? (
          <Typography key={index} color="text.primary">
            {part}
          </Typography>
        ) : (
          <Link
            key={index}
            component="button"
            onClick={() => {
              onCwdChange(parts.slice(0, index + 1).join("/") + "/");
            }}
          >
            {part}
          </Link>
        )
      )}
    </Breadcrumbs>
  );
}

// DropZone wrapper
function DropZone({
  children,
  onDrop,
}: {
  children: React.ReactNode;
  onDrop: (files: FileList) => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <Box
      sx={{
        flexGrow: 1,
        overflowY: "auto",
        backgroundColor: (theme) => theme.palette.background.default,
        filter: dragging ? "brightness(0.9)" : "none",
        transition: "filter 0.2s",
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e.dataTransfer.files);
        setDragging(false);
      }}
    >
      {children}
    </Box>
  );
}

// Main Component
function Main({
  search,
  onError,
}: {
  search: string;
  onError: (error: Error) => void;
}) {
  const [cwd, setCwd] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [multiSelected, setMultiSelected] = useState<string[] | null>(null);
  const [showUploadDrawer, setShowUploadDrawer] = useState(false);
  const [showTextPadDrawer, setShowTextPadDrawer] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const hadActiveUploadsRef = useRef(false);

  const transferQueue = useTransferQueue();
  const uploadEnqueue = useUploadEnqueue();

  const fetchFiles = useCallback(() => {
    fetchPath(cwd)
      .then((files) => {
        setFiles(files);
        setMultiSelected(null);
      })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [cwd, onError]);

  useEffect(() => setLoading(true), [cwd]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    let canceled = false;
    void getShareStatus()
      .then((enabled) => {
        if (!canceled) setShareEnabled(enabled);
      })
      .catch(() => {
        if (!canceled) setShareEnabled(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const uploadTasks = transferQueue.filter((task) => task.type === "upload");
    const hasActiveUploads = uploadTasks.some((task) =>
      ["pending", "in-progress", "paused"].includes(task.status)
    );

    if (hasActiveUploads) {
      hadActiveUploadsRef.current = true;
      return;
    }

    if (!hadActiveUploadsRef.current) return;
    hadActiveUploadsRef.current = false;
    fetchFiles();
  }, [fetchFiles, transferQueue]);

  const filteredFiles = useMemo(
    () =>
      (search
        ? files.filter((file) =>
            file.key.toLowerCase().includes(search.toLowerCase())
          )
        : files
      ).sort((a, b) => (isDirectory(a) ? -1 : isDirectory(b) ? 1 : 0)),
    [files, search]
  );

  const handleMultiSelect = useCallback((key: string) => {
    setMultiSelected((prev) => {
      if (prev === null) return [key];
      if (prev.includes(key)) {
        const updated = prev.filter((k) => k !== key);
        return updated.length ? updated : null;
      }
      return [...prev, key];
    });
  }, []);

  return (
    <>
      {cwd && <PathBreadcrumb path={cwd} onCwdChange={setCwd} />}

      {loading ? (
        <Centered>
          <CircularProgress />
        </Centered>
      ) : (
        <DropZone
          onDrop={(files) => {
            uploadEnqueue(
              ...Array.from(files).map((file) => ({ file, basedir: cwd }))
            );
          }}
        >
          <FileGrid
            files={filteredFiles}
            onCwdChange={(newCwd: string) => setCwd(newCwd)}
            multiSelected={multiSelected}
            onMultiSelect={handleMultiSelect}
            emptyMessage={<Centered>No files or folders</Centered>}
          />
        </DropZone>
      )}

      {multiSelected === null && (
        <>
          <UploadFab onClick={() => setShowUploadDrawer(true)} />
          <Button
            variant="contained"
            startIcon={<NoteAddIcon />}
            sx={{
              position: "fixed",
              bottom: 90,
              right: 24,
              zIndex: 999,
            }}
            onClick={() => setShowTextPadDrawer(true)}
          >
            Open TextPad
          </Button>
        </>
      )}

      <UploadDrawer
        open={showUploadDrawer}
        setOpen={setShowUploadDrawer}
        cwd={cwd}
        onUpload={fetchFiles}
      />

      <TextPadDrawer
        open={showTextPadDrawer}
        setOpen={setShowTextPadDrawer}
        cwd={cwd}
      />

      <MultiSelectToolbar
        multiSelected={multiSelected}
        shareEnabled={shareEnabled}
        onClose={() => setMultiSelected(null)}
        onDownload={async () => {
          if (multiSelected?.length !== 1) return;
          await downloadFile(multiSelected[0]);
        }}
        onRename={async () => {
          if (multiSelected?.length !== 1) return;
          const newName = window.prompt("Rename to:");
          if (!newName) return;
          await copyPaste(multiSelected[0], cwd + newName, true);
          fetchFiles();
        }}
        onDelete={async () => {
          if (!multiSelected?.length) return;
          const filenames = multiSelected
            .map((key) => key.replace(/\/$/, "").split("/").pop())
            .join("\n");
          const confirmMessage = "Delete the following file(s) permanently?";
          if (!window.confirm(`${confirmMessage}\n${filenames}`)) return;
          for (const key of multiSelected) await deletePath(key);
          fetchFiles();
        }}
        onShare={async () => {
          if (multiSelected?.length !== 1) return;
          const data = await createShareLink(multiSelected[0]);
          await systemShare(data);
        }}
      />
    </>
  );
}

export default Main;
