import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./I18nProvider";
import "@xyflow/react/dist/style.css";
import "./tokens.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
