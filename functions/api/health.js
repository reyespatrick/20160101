/** Liveness probe: also reports which secrets the deployment has, never their values. */
export const onRequestGet = ({ env }) =>
  Response.json({
    ok: true,
    runtime: 'cloudflare-pages',
    mock: env.INMOVILLA_MOCK === '1',
    configured: {
      supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
      appSecret: Boolean(env.APP_SECRET),
    },
  })
