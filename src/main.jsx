import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { StatPanelOverlay } from "./StatPanels.jsx";
import { ProductionOverlay } from "./ProductionStudio.jsx";
import CloudStudio from "./CloudStudio.jsx";

const statsOverlay =
  new URLSearchParams(window.location.search).get("view") === "stats";
const productionOverlay = [
  "collector-panel",
  "ultimate-hud",
  "scoreboard",
].includes(new URLSearchParams(window.location.search).get("view"));

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <CloudStudio
      legacy={
        productionOverlay ? (
          <ProductionOverlay />
        ) : statsOverlay ? (
          <StatPanelOverlay />
        ) : (
          <App />
        )
      }
    />
  </StrictMode>,
);
