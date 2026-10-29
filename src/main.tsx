import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ListenPanel } from "./components/ListenPanel";

// The listening panel is its own small window (index.html#listen); everything else is the app.
const listenWindow = window.location.hash === "#listen";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {listenWindow ? (
      <ThemeProvider>
        <ListenPanel />
      </ThemeProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
