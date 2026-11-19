// Sends the e-mail queued in public.notifications through Gmail SMTP (port 465;
// Edge Functions block 25 and 587). pg_cron calls it every minute while mail is
// waiting (migration 5). It takes no input, so calling it only sends mail sooner.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   SMTP_PASS  the Gmail app password (required)
//   SMTP_USER  the Gmail address (default myrs.share@gmail.com)
//   SITE_URL   the site address (default https://hanksonwu-design.github.io/myrs)
import nodemailer from 'npm:nodemailer@6.9.16';
import postgres from 'npm:postgres@3.4.5';

const SMTP_USER = Deno.env.get('SMTP_USER') || 'myrs.share@gmail.com';
const SITE_URL = (Deno.env.get('SITE_URL') || 'https://hanksonwu-design.github.io/myrs').replace(/\/$/, '');

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 1 });
const mailer = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: SMTP_USER, pass: Deno.env.get('SMTP_PASS') },
});

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

Deno.serve(async () => {
  if (!Deno.env.get('SMTP_PASS')) {
    return Response.json({ error: 'SMTP_PASS is not set' }, { status: 500 });
  }
  const rows = await sql`select * from private.claim_notifications(40)`;
  let sent = 0;
  for (const n of rows) {
    if (!n.email) {
      await sql`select private.finish_notification(${n.id}, true, 'no e-mail address')`;
      continue;
    }
    const url = SITE_URL + n.link;
    try {
      await mailer.sendMail({
        from: { name: 'Myrs 你的我的共享平台', address: SMTP_USER },
        to: n.email,
        subject: n.subject,
        text: `${n.body}\n\n打開 Myrs：${url}\n\n這封信由 Myrs 自動寄出，請不要直接回覆。`,
        html:
          `<div style="font-size:15px;line-height:1.6">${esc(n.body).replaceAll('\n', '<br>')}</div>` +
          `<p><a href="${esc(url)}" style="display:inline-block;padding:10px 18px;background:#00A078;color:#fff;` +
          `border-radius:10px;text-decoration:none;font-weight:bold">打開 Myrs</a></p>` +
          `<p style="color:#888;font-size:12px">這封信由 Myrs 你的我的共享平台自動寄出，請不要直接回覆。</p>`,
      });
      await sql`select private.finish_notification(${n.id}, true, '')`;
      sent++;
    } catch (e) {
      await sql`select private.finish_notification(${n.id}, false, ${String(e)})`;
    }
  }
  return Response.json({ claimed: rows.length, sent });
});
