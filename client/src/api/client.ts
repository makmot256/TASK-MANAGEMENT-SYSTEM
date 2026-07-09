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
    const config = err.config;
    const networkErr = !err.response && (
      err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.message === 'Network Error'
    );
    // Retry once when the API restarts (node --watch) mid-request.
    if (config && !config.__retry && networkErr) {
      config.__retry = true;
      await new Promise((r) => setTimeout(r, 1500));
      return api(config);
    }
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('tms_token');
      if (!location.pathname.startsWith('/reset-password')) location.href = '/';
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e: any) => e?.response?.data?.message || e?.message || 'Something went wrong.';

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
