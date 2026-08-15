import { memo } from "react";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import CodeIcon from "@mui/icons-material/Code";
import FolderIcon from "@mui/icons-material/Folder";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import ImageIcon from "@mui/icons-material/Image";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import PdfIcon from "@mui/icons-material/PictureAsPdf";
import VideoFileIcon from "@mui/icons-material/VideoFile";

const MimeIcon = memo(function MimeIcon({
  contentType,
}: {
  contentType?: string;
}) {
  const type = contentType ?? "";
  return type.startsWith("image/") ? (
    <ImageIcon fontSize="large" />
  ) : type.startsWith("audio/") ? (
    <AudioFileIcon fontSize="large" />
  ) : type.startsWith("video/") ? (
    <VideoFileIcon fontSize="large" />
  ) : type === "application/pdf" ? (
    <PdfIcon fontSize="large" />
  ) : ["application/zip", "application/gzip"].includes(type) ? (
    <FolderZipOutlinedIcon fontSize="large" />
  ) : type.startsWith("text/") ? (
    <CodeIcon fontSize="large" />
  ) : type === "application/x-directory" ? (
    <FolderIcon fontSize="large" />
  ) : (
    <InsertDriveFileOutlinedIcon fontSize="large" />
  );
});

export default MimeIcon;
