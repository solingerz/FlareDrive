import {
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  Button,
} from "@mui/material";
import { useMemo, useState } from "react";
import {
  TransferTask,
  useTransferQueue,
  useTransferQueueControls,
} from "../features/transfer/transferQueue";
import { humanReadableSize } from "../features/transfer/utils";
import {
  CheckCircleOutline as CheckCircleOutlineIcon,
  ErrorOutline as ErrorOutlineIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon,
  Close as CloseIcon,
  Replay as ReplayIcon,
} from "@mui/icons-material";

function taskProgressPercent(task: TransferTask): number {
  if (!task.total) return 0;
  return Math.max(0, Math.min(100, (task.loaded / task.total) * 100));
}

function formatTaskStatus(task: TransferTask): string {
  switch (task.status) {
    case "pending":
      return "Pending";
    case "in-progress":
      return "Uploading";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return task.status;
  }
}

function ProgressRingAction({
  title,
  progress,
  onClick,
  icon,
}: {
  title: string;
  progress: number;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  const value = Math.max(0, Math.min(100, progress));

  return (
    <Tooltip title={title}>
      <Box
        sx={{
          position: "relative",
          width: 30,
          height: 30,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          verticalAlign: "middle",
        }}
      >
        <CircularProgress
          variant="determinate"
          value={100}
          size={30}
          sx={{ color: "action.disabledBackground", position: "absolute" }}
        />
        <CircularProgress
          variant="determinate"
          value={value}
          size={30}
          sx={{ position: "absolute" }}
        />
        <IconButton size="small" onClick={onClick} sx={{ zIndex: 1 }}>
          {icon}
        </IconButton>
      </Box>
    </Tooltip>
  );
}

function ProgressDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(1);
  const transferQueue = useTransferQueue();
  const controls = useTransferQueueControls();

  const tasks = useMemo(() => {
    const taskType = tab === 0 ? "download" : "upload";
    return transferQueue.filter((task) => task.type === taskType);
  }, [tab, transferQueue]);

  const uploadTasks = useMemo(
    () => transferQueue.filter((task) => task.type === "upload"),
    [transferQueue]
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Progress</DialogTitle>
      <Tabs
        value={tab}
        onChange={(_, newTab) => setTab(newTab)}
        sx={{ "& .MuiTab-root": { flexBasis: "50%" } }}
      >
        <Tab label="Downloads" />
        <Tab label="Uploads" />
      </Tabs>

      {tasks.length === 0 ? (
        <DialogContent>
          <Typography textAlign="center" color="text.secondary">
            No tasks
          </Typography>
        </DialogContent>
      ) : (
        <DialogContent sx={{ padding: 0 }}>
          <List>
            {tasks.map((task) => (
              <ListItem key={task.id}>
                <ListItemText
                  sx={{ pr: tab === 1 ? 18 : 8 }}
                  primary={task.name}
                  secondary={`${formatTaskStatus(task)} · ${humanReadableSize(
                    task.loaded
                  )} / ${humanReadableSize(task.total)} (${taskProgressPercent(task).toFixed(
                    0
                  )}%)`}
                  primaryTypographyProps={{ noWrap: true, title: task.name }}
                  secondaryTypographyProps={{ noWrap: true }}
                />

                <ListItemSecondaryAction>
                  <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    {task.status === "failed" ? (
                      <Tooltip title={task.error?.message || "Task failed"}>
                        <ErrorOutlineIcon color="error" />
                      </Tooltip>
                    ) : task.status === "completed" ? (
                      <CheckCircleOutlineIcon color="success" />
                    ) : task.status === "in-progress" && tab === 0 ? (
                      <CircularProgress
                        variant="determinate"
                        size={24}
                        value={taskProgressPercent(task)}
                      />
                    ) : null}

                    {tab === 1 && task.status === "in-progress" && (
                      <ProgressRingAction
                        title="Pause"
                        progress={taskProgressPercent(task)}
                        onClick={() => controls.pauseTask(task.id)}
                        icon={<PauseIcon fontSize="small" />}
                      />
                    )}

                    {tab === 1 && ["paused", "pending"].includes(task.status) && (
                      <ProgressRingAction
                        title="Resume"
                        progress={taskProgressPercent(task)}
                        onClick={() => controls.resumeTask(task.id)}
                        icon={<PlayArrowIcon fontSize="small" />}
                      />
                    )}

                    {tab === 1 && task.status === "failed" && (
                      <Tooltip title="Retry">
                        <IconButton
                          size="small"
                          onClick={() => controls.retryTask(task.id)}
                        >
                          <ReplayIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}

                    {tab === 1 && !["completed", "canceled"].includes(task.status) && (
                      <Tooltip title="Cancel">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => controls.cancelTask(task.id)}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </DialogContent>
      )}

      <DialogActions>
        {tab === 1 && uploadTasks.length > 0 && (
          <Button onClick={controls.clearFinished}>Clear Finished</Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default ProgressDialog;
