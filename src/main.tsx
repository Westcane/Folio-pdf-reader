import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

if (import.meta.env.DEV)
  void import("./dev/logs").then((module) => module.installErrorCapture());

// Reuse the root if Vite re-evaluates this entry before a full reload.
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
