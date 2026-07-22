import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('tms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config as (typeof err.config & { __retry?: boolean; __retryCount?: number }) | undefined;
    const status = err.response?.status;
    const networkErr = !err.response && (
      err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED' || err.message === 'Network Error'
    );
    // Vite proxy returns 502/503/504 while the API restarts (node --watch).
    const gatewayErr = status === 502 || status === 503 || status === 504;
    const retries = config?.__retryCount ?? 0;

    if (config && retries < 2 && (networkErr || gatewayErr)) {
      config.__retryCount = retries + 1;
      config.__retry = true;
      await new Promise((r) => setTimeout(r, 800 + retries * 700));
      return api(config);
    }
    if (status === 401 && !config?.url?.includes('/auth/login')) {
      localStorage.removeItem('tms_token');
      if (!location.pathname.startsWith('/reset-password')) location.href = '/';
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e: any) => {
  const status = e?.response?.status;
  const serverMsg = e?.response?.data?.message;
  if (serverMsg) return serverMsg;
  if (status === 502 || status === 503 || status === 504) {
    return 'Server or database is starting up — please try again in a moment.';
  }
  if (!e?.response && (e?.code === 'ECONNREFUSED' || e?.message === 'Network Error')) {
    return 'Cannot reach the server. Make sure the app is running (npm run dev).';
  }
  return e?.message || 'Request failed. Please try again.';
};

// Downloads a protected file through the authenticated API client, then saves it
// to disk. A plain <a href> cannot be used because it won't send the JWT header.
export async function downloadFile(url: string, filename: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
