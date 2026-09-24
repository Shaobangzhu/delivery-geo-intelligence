import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { History } from "./pages/History";
import { Merchants } from "./pages/Merchants";

export function App() {
  return <div className="app-frame">
    <header className="site-header">
      <div className="brand">
        <span className="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 30" fill="none">
          <path d="M12 29S1 16.2 1 11a11 11 0 1 1 22 0c0 5.2-11 18-11 18Z" fill="currentColor" />
          <circle cx="12" cy="11" r="4" fill="white" />
        </svg></span>
        <div><div className="brand-row"><span className="brand-name">Delivery Geo Intelligence</span>
          <span className="brand-tag">Observed Delivery Activity</span></div>
          <p>Spatial insights from personally observed last-mile delivery activity.</p></div>
      </div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <NavLink to="/dashboard" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>Dashboard</NavLink>
        <NavLink to="/history" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>History</NavLink>
        <NavLink to="/merchants" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>Merchants</NavLink>
      </nav>
    </header>
    <main className="page-content"><Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/history" element={<History />} />
      <Route path="/merchants" element={<Merchants />} />
    </Routes></main>
    <footer className="site-footer"><span>Delivery Geo Intelligence</span>
      <span>Personal observational dataset. Results do not represent overall demand.</span></footer>
  </div>;
}
