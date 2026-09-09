<%@ WebHandler Language="C#" Class="ApiwebHop" %>
/*
  Immoba apiweb hop — a fixed-IP relay for Inmovilla's apiweb, for IIS (.NET Framework 4.6.1+).

  Cloudflare Pages Functions (or any host without a stable egress IP) POST the exact apiweb form body
  here instead of to apiweb.inmovilla.com; this handler forwards it unchanged and returns the answer.
  Inmovilla then only ever sees this server's IP.

  - Requires the shared secret in the X-Hop-Secret header (appSettings/HopSecret in web.config).
  - Caps outgoing calls at MaxPerMinute (default 60; Inmovilla blocks the IP at 70/min).
  - Never logs or stores credentials: the body is streamed through.
  No compilation step: IIS compiles this file on first request.
*/
using System;
using System.Collections.Generic;
using System.Configuration;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web;

public class ApiwebHop : HttpTaskAsyncHandler
{
    static readonly HttpClient Client = CreateClient();
    static readonly object Gate = new object();
    static readonly Queue<DateTime> Calls = new Queue<DateTime>();

    static HttpClient CreateClient()
    {
        // TLS 1.2 is enough for Inmovilla; TLS 1.3 only exists from .NET Framework 4.8, so it is optional.
        try { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; }
        catch (NotSupportedException) { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12; }
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("immoba-hop/1.0");
        c.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        return c;
    }

    static string Setting(string name, string fallback)
    {
        var v = ConfigurationManager.AppSettings[name];
        return string.IsNullOrEmpty(v) ? fallback : v;
    }

    /// Sliding one-minute window; true when a slot is available.
    static bool TakeSlot(int limit)
    {
        lock (Gate)
        {
            var cutoff = DateTime.UtcNow.AddMinutes(-1);
            while (Calls.Count > 0 && Calls.Peek() < cutoff) Calls.Dequeue();
            if (Calls.Count >= limit) return false;
            Calls.Enqueue(DateTime.UtcNow);
            return true;
        }
    }

    public override async Task ProcessRequestAsync(HttpContext context)
    {
        var req = context.Request;
        var res = context.Response;
        res.Cache.SetCacheability(HttpCacheability.NoCache);

        if (req.HttpMethod == "GET")
        {
            res.ContentType = "application/json";
            res.Write("{\"ok\":true,\"hop\":\"apiweb\"}");
            return;
        }
        if (req.HttpMethod != "POST") { res.StatusCode = 405; return; }

        var secret = Setting("HopSecret", "");
        var given = req.Headers["X-Hop-Secret"] ?? "";
        if (secret.Length == 0 || !FixedTimeEquals(secret, given))
        {
            res.StatusCode = 403;
            res.ContentType = "application/json";
            res.Write("{\"error\":\"hop secret missing or wrong\"}");
            return;
        }

        int limit;
        if (!int.TryParse(Setting("MaxPerMinute", "60"), out limit)) limit = 60;
        if (!TakeSlot(limit))
        {
            res.StatusCode = 429;
            res.ContentType = "application/json";
            res.Write("{\"error\":\"apiweb rate cap reached on the hop, retry in a minute\"}");
            return;
        }

        string body;
        using (var reader = new StreamReader(req.InputStream, Encoding.UTF8)) body = await reader.ReadToEndAsync();
        if (body.Length == 0 || body.Length > 64 * 1024) { res.StatusCode = 400; return; }

        var upstream = Setting("ApiwebUrl", "https://apiweb.inmovilla.com/apiweb/apiweb.php");
        try
        {
            using (var content = new StringContent(body, Encoding.UTF8, "application/x-www-form-urlencoded"))
            using (var answer = await Client.PostAsync(upstream, content))
            {
                res.StatusCode = (int)answer.StatusCode;
                res.ContentType = answer.Content.Headers.ContentType != null ? answer.Content.Headers.ContentType.ToString() : "application/json";
                var bytes = await answer.Content.ReadAsByteArrayAsync();
                res.OutputStream.Write(bytes, 0, bytes.Length);
            }
        }
        catch (TaskCanceledException)
        {
            res.StatusCode = 504;
            res.ContentType = "application/json";
            res.Write("{\"error\":\"Inmovilla no responde\"}");
        }
        catch (HttpRequestException ex)
        {
            res.StatusCode = 502;
            res.ContentType = "application/json";
            res.Write("{\"error\":\"" + HttpUtility.JavaScriptStringEncode(ex.Message) + "\"}");
        }
    }

    static bool FixedTimeEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    public override bool IsReusable { get { return true; } }
}
