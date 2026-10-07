async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  const body = await res.text();
  const data = body ? JSON.parse(body) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) =>
  api(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
export const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path) => api(path, { method: 'DELETE' });
