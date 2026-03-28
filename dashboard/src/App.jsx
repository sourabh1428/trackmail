import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Recipients from "./pages/Recipients";
import Templates from "./pages/Templates";
import Navbar from "./components/Navbar";

function ProtectedLayout() {
  const token = localStorage.getItem("trackmail_token");
  if (!token) return <Navigate to="/login" replace />;
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 py-6">
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
          <Route path="/templates" element={<Templates />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
