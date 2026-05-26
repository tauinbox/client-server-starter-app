/**
 * Branded HTML email layout, shared by every transactional message.
 *
 * Kept as an inline string (not a .hbs file) so it ships in the compiled
 * `dist/` without an asset-copy step — `nest build` only emits `.ts` output.
 * All values are rendered with Handlebars double-braces, which HTML-escape by
 * default, so dynamic content (URLs, email addresses) is safe to interpolate.
 */
export const EMAIL_TEMPLATE_SOURCE = `<!DOCTYPE html>
<html lang="{{lang}}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{subject}}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e3e5e8;">
            <tr>
              <td style="background-color:#1a73e8;padding:20px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:600;letter-spacing:0.3px;">{{appName}}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;color:#202124;">{{heading}}</h1>
                {{#each paragraphs}}
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3c4043;">{{this}}</p>
                {{/each}}
                {{#if button}}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:6px;background-color:#1a73e8;">
                      <a href="{{button.url}}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">{{button.label}}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#80868b;word-break:break-all;">{{button.url}}</p>
                {{/if}}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #e3e5e8;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#80868b;">{{footer}}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
