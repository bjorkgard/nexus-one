import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startDataSource } from "./data/boot";
import "./style.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Root element #app not found");
}

startDataSource();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
