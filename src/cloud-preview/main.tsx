import React from "react";
import { createRoot } from "react-dom/client";
import CloudTest from "./CloudTest";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CloudTest />
  </React.StrictMode>,
);
