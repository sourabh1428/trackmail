import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Recipients from "./pages/Recipients";
import Templates from "./pages/Templates";
import Companies from "./pages/Companies";
import Analytics from "./pages/Analytics";
import Navbar from "./components/Navbar";

function ProtectedLayout() {
  const token = localStorage.getItem("trackmail_token");
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/recipients" element={<Recipients />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/analytics" element={<Analytics />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
