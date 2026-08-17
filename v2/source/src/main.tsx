import React from "react";
import { createRoot } from "react-dom/client";
import Game from "./Game";
import "./game.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Game />
  </React.StrictMode>,
);
