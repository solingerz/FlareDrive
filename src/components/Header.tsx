import { IconButton, InputBase, Menu, MenuItem, Toolbar } from "@mui/material";
import { useState } from "react";
import { MoreHoriz as MoreHorizIcon } from "@mui/icons-material";

function Header({
  search,
  onSearchChange,
  setShowProgressDialog,
}: {
  search: string;
  onSearchChange: (newSearch: string) => void;
  setShowProgressDialog: (show: boolean) => void;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [openProgressAfterMenuClose, setOpenProgressAfterMenuClose] =
    useState(false);

  return (
    <Toolbar disableGutters sx={{ padding: 1 }}>
      <InputBase
        size="small"
        fullWidth
        placeholder="Search…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        sx={{
          backgroundColor: "whitesmoke",
          borderRadius: "999px",
          padding: "8px 16px",
        }}
      />
      <IconButton
        aria-label="More"
        color="inherit"
        sx={{ marginLeft: 0.5 }}
        onClick={(e) => {
          setOpenProgressAfterMenuClose(false);
          setAnchorEl(e.currentTarget);
        }}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        disableRestoreFocus={openProgressAfterMenuClose}
        TransitionProps={{
          onExited: () => {
            if (!openProgressAfterMenuClose) return;
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            setShowProgressDialog(true);
            setOpenProgressAfterMenuClose(false);
          },
        }}
      >
        <MenuItem>View as</MenuItem>
        <MenuItem>Sort by</MenuItem>
        <MenuItem
          onClick={() => {
            setOpenProgressAfterMenuClose(true);
            setAnchorEl(null);
          }}
        >
          Progress
        </MenuItem>
      </Menu>
    </Toolbar>
  );
}

export default Header;
