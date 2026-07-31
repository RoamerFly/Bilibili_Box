import { AppShell } from "./components/layout/app-shell";
import { ErrorBoundary } from "./components/error-boundary";

function App() {
  return (
    <ErrorBoundary title="BiliBox 加载失败">
      <AppShell />
    </ErrorBoundary>
  );
}

export default App;
