import { api } from "../api";

export const adminApi = (path, options) => api(`/admin${path}`, options);
export const write = (path, body, method = "POST") => adminApi(path, { method, body: JSON.stringify(body) });
export const orderPath = id => `/orders/${encodeURIComponent(id)}`;
