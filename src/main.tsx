import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startDataSource } from "./data/boot";
import "./style.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Root element #app not found");
}

try {
  startDataSource();
} catch (error) {
  // The app still renders without a data source.
  if (globalThis.reportError) globalThis.reportError(error);
  else console.error(error);
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
