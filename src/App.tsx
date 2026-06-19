import { ThemeProvider } from "@emotion/react";
import {
  createTheme,
  CssBaseline,
  GlobalStyles,
  Snackbar,
  Stack,
} from "@mui/material";
import React, { useEffect, useState } from "react";

import Header from "./components/Header";
import Main from "./components/Main";
import ProgressDialog from "./components/ProgressDialog";
import { TransferQueueProvider } from "./features/transfer/transferQueue";

const globalStyles = (
  <GlobalStyles styles={{ "html, body, #root": { height: "100%" } }} />
);

const theme = createTheme({
  palette: { primary: { main: "#f38020" } },
});

function App() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showProgressDialog, setShowProgressDialog] = React.useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {globalStyles}
      <TransferQueueProvider>
        <Stack sx={{ height: "100%" }}>
          <Header
            search={search}
            onSearchChange={(newSearch: string) => setSearch(newSearch)}
            setShowProgressDialog={setShowProgressDialog}
          />
          <Main search={debouncedSearch} onError={setError} />
        </Stack>
        <Snackbar
          autoHideDuration={5000}
          open={Boolean(error)}
          message={error?.message}
          onClose={() => setError(null)}
        />
        <ProgressDialog
          open={showProgressDialog}
          onClose={() => setShowProgressDialog(false)}
        />
      </TransferQueueProvider>
    </ThemeProvider>
  );
}

export default App;
