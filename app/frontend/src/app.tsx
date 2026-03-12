export default function App() {
  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="shrink-0">
        <div>top bar placeholder</div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-row min-h-0">
        {/* Sidebar */}
        <div>sidebar placeholder</div>

        {/* Terminal area */}
        <div className="flex-1">terminal placeholder</div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0">
        <div>bottom bar placeholder</div>
      </div>
    </div>
  );
}
