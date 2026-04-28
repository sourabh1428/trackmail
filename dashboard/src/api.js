import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("trackmail_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("trackmail_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export function getTimeline(bunchId) {
  return api.get(`/api/timeline?bunchId=${bunchId}`).then((r) => r.data);
}

export function getDomains(bunchId) {
  return api.get(`/api/domains?bunchId=${bunchId}`).then((r) => r.data);
}

export default api;
