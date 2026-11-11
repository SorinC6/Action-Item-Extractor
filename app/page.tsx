import Workspace from "./workspace";

export default function HomePage() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-6" />
              <path d="m11.5 10.5 2.5 2.5 5.5-6M8 15.5h3" />
            </svg>
          </span>
          <span className="brand-name">Action Item Extractor</span>
        </div>
      </header>
      <main className="main">
        <div className="intro">
          <h1>Meeting follow-up</h1>
          <p>Turn meeting notes into a checklist of next steps.</p>
        </div>
        <Workspace />
      </main>
    </>
  );
}
