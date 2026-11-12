import { App as AntApp } from "antd";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./workspace.css";
import "./particle-button.css";
import "./rednote.css";
import "./refinement.css";
import "./preview-design.css";
import "./forest-theme.css";
import "./appearance.css";
import "./pixel-theme.css";
import "./rewrites/workspace-usability.css";
import "./rose-consistency.css";
import "./admin/admin-style.css";
import "./desktop-workspaces.css";
import "./rewrites/image-composer.css";
import "./rewrites/generation-composer.css";
import { WorkspaceAppearance } from "./WorkspaceAppearance";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceAppearance>
      <AntApp>
        <App />
      </AntApp>
    </WorkspaceAppearance>
  </React.StrictMode>,
);
