import request from 'supertest';
function extractCsrfCookie(setCookieHeader) {
    const raw = (setCookieHeader ?? []).find((c) => c.startsWith('admin_csrf='));
    if (!raw)
        throw new Error('Login response did not set admin_csrf cookie.');
    const value = raw.split(';')[0].split('=')[1];
    return decodeURIComponent(value);
}
export async function loginAsAdmin(app, userIdentifier, password) {
    const agent = request.agent(app);
    const res = await agent.post('/api/admin/auth/login').send({ userIdentifier, password });
    if (res.status !== 200) {
        throw new Error(`Login failed for ${userIdentifier}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const csrfToken = extractCsrfCookie(res.headers['set-cookie']);
    return {
        agent,
        csrfToken,
        post: (url) => agent.post(url).set('X-CSRF-Token', csrfToken),
        put: (url) => agent.put(url).set('X-CSRF-Token', csrfToken),
        patch: (url) => agent.patch(url).set('X-CSRF-Token', csrfToken),
        del: (url) => agent.delete(url).set('X-CSRF-Token', csrfToken),
    };
}
