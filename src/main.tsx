import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Boot trace log: the moment main.tsx is transpiled by Vite and delivered to the WebView.
// The time between `<script type="module" src="/src/main.tsx">` in index.html and this point
// is the cost of "Vite cold transpile + dependency bundling" — in dev mode this often eats seconds to tens of seconds.
declare global {
  interface Window { __bootMark?: (stage: string, detail?: string) => void; }
}
window.__bootMark?.("main-module-eval", "main.tsx module code running");

// Error boundary: catch and display errors thrown during render, so the whole tree does not unmount into a black screen.
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: "24px",
            background: "#02182B",
            color: "#fff",
            fontFamily: "Consolas, ui-monospace, monospace",
            fontSize: 13,
            lineHeight: 1.6,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <div style={{ color: "#FBBF24", fontWeight: 700, marginBottom: 12 }}>
            App render failed (caught by React ErrorBoundary)
          </div>
          <div style={{ color: "#F87171" }}>{this.state.error.message}</div>
          <div style={{ marginTop: 12, opacity: 0.8 }}>
            {this.state.error.stack}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

window.__bootMark?.("react-mount", "calling ReactDOM.createRoot().render()");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
