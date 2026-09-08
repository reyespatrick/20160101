/** Liveness probe: also reports which secrets the deployment has, never their values. */
export const onRequestGet = ({ env }) =>
  Response.json({
    ok: true,
    runtime: 'cloudflare-pages',
    upstream: env.INMOVILLA_API_URL ? 'custom' : 'inmovilla',
    configured: {
      supabase: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
      appSecret: Boolean(env.APP_SECRET),
    },
  })
