import React, { memo } from "react";
import {
  Box,
  Grid,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import MimeIcon from "./MimeIcon";
import { humanReadableSize } from "../features/transfer/utils";

export interface FileItem {
  key: string;
  size: number;
  uploaded: string;
  httpMetadata: { contentType: string };
  customMetadata?: { thumbnail?: string };
}

function extractFilename(key: string) {
  return key.split("/").pop();
}

export function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function isDirectory(file: FileItem) {
  return file.httpMetadata?.contentType === "application/x-directory";
}

const formatDate = (() => {
  const cache = new Map<string, string>();
  return (uploaded: string) => {
    const cached = cache.get(uploaded);
    if (cached) return cached;
    const formatted = new Date(uploaded).toLocaleString();
    if (cache.size < 1000) cache.set(uploaded, formatted);
    return formatted;
  };
})();

const FileItemRow = memo(function FileItemRow({
  file,
  multiSelected,
  onMultiSelect,
  onCwdChange,
}: {
  file: FileItem;
  multiSelected: string[] | null;
  onMultiSelect: (key: string) => void;
  onCwdChange: (newCwd: string) => void;
}) {
  const selected = multiSelected !== null && multiSelected.includes(file.key);
  const isDir = isDirectory(file);
  const dirLabel = isDir ? "Folder" : humanReadableSize(file.size);

  const handleClick = () => {
    if (multiSelected !== null) {
      onMultiSelect(file.key);
    } else if (isDir) {
      onCwdChange(file.key + "/");
    } else {
      window.open(
        `/webdav/${encodeKey(file.key)}`,
        "_blank",
        "noopener,noreferrer"
      );
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onMultiSelect(file.key);
  };

  return (
    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }}>
      <ListItemButton
        selected={selected}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        sx={{ userSelect: "none" }}
      >
        <ListItemIcon sx={{ minWidth: 56 }}>
          {file.customMetadata?.thumbnail ? (
            <img
              src={`/webdav/_$flaredrive$/thumbnails/${file.customMetadata.thumbnail}.png`}
              alt={file.key}
              loading="lazy"
              style={{ width: 36, height: 36, objectFit: "cover" }}
            />
          ) : (
            <MimeIcon contentType={file.httpMetadata.contentType} />
          )}
        </ListItemIcon>
        <ListItemText
          primary={extractFilename(file.key)}
          slotProps={{ primary: { noWrap: true } }}
          secondary={
            <React.Fragment>
              <Box
                sx={{
                  display: "block",
                  marginRight: 1,
                }}
              >
                {formatDate(file.uploaded)}
              </Box>
              {dirLabel}
            </React.Fragment>
          }
        />
      </ListItemButton>
    </Grid>
  );
});

const FileGrid = memo(function FileGrid({
  files,
  onCwdChange,
  multiSelected,
  onMultiSelect,
  emptyMessage,
}: {
  files: FileItem[];
  onCwdChange: (newCwd: string) => void;
  multiSelected: string[] | null;
  onMultiSelect: (key: string) => void;
  emptyMessage?: React.ReactNode;
}) {
  return files.length === 0 ? (
    emptyMessage
  ) : (
    <Grid container sx={{ paddingBottom: "48px" }}>
      {files.map((file) => (
        <FileItemRow
          key={file.key}
          file={file}
          multiSelected={multiSelected}
          onMultiSelect={onMultiSelect}
          onCwdChange={onCwdChange}
        />
      ))}
    </Grid>
  );
});

export default FileGrid;
