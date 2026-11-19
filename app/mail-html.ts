// Rich-text helpers shared by the compose editor (browser) and the draft API (Worker).
// They work on strings only, so they run without a DOM.

const ALLOWED = new Set(["a", "b", "strong", "i", "em", "u", "s", "strike", "del", "br", "p", "div", "span", "font", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "hr", "sub", "sup", "table", "thead", "tbody", "tr", "td", "th", "img", "pre", "code", "center"]);
const DROP_WITH_CONTENT = /<(script|style|head|title|iframe|object|embed|svg|math|template|noscript|textarea|select|button|form|video|audio)\b[\s\S]*?<\/\1\s*>/gi;
const STYLE_PROPS = new Set(["color", "background-color", "background", "font-size", "font-weight", "font-style", "font-family", "text-decoration", "text-align", "margin", "margin-left", "margin-right", "margin-top", "margin-bottom", "padding", "padding-left", "line-height", "border", "border-left", "border-collapse", "width", "max-width", "height", "vertical-align", "display", "list-style-type", "white-space", "border-top", "border-bottom", "border-right", "border-radius", "letter-spacing", "font", "padding-top", "padding-bottom", "padding-right", "text-transform", "min-width", "border-spacing"]);
const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decode = (value: string) => value.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(Number(dec))).replace(/&colon;/gi, ":").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function cleanStyle(style: string) {
  return style.split(";").map(rule => {
    const at = rule.indexOf(":"); if (at < 0) return "";
    const prop = rule.slice(0, at).trim().toLowerCase(), value = rule.slice(at + 1).trim();
    if (!STYLE_PROPS.has(prop) || !value || value.length > 200) return "";
    if (/url\s*\(|expression|javascript:|\\|[<>]|@import/i.test(value)) return "";
    return `${prop}: ${value}`;
  }).filter(Boolean).join("; ");
}

function safeUrl(raw: string, image: boolean) {
  const value = decode(raw).replace(/[\u0000- \u007f]+/g, "");
  if (image) return /^(https:|data:image\/(png|jpe?g|gif|webp);base64,|cid:)/i.test(value) ? raw.trim() : "";
  return /^(https?:|mailto:|tel:|#)/i.test(value) ? raw.trim() : "";
}

/** Keeps formatting produced by the editor (or pasted from Word/Outlook) and drops anything active. */
export function sanitizeComposeHtml(html: string) {
  const source = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(DROP_WITH_CONTENT, "");
  let out = "";
  let last = 0;
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  for (let match = tag.exec(source); match; match = tag.exec(source)) {
    out += source.slice(last, match.index).replace(/</g, "&lt;");
    last = tag.lastIndex;
    const [, closing, rawName, rawAttrs] = match;
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (closing) { if (!["br", "hr", "img"].includes(name)) out += `</${name}>`; continue; }
    const attrs: string[] = [];
    const attr = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (let a = attr.exec(rawAttrs); a; a = attr.exec(rawAttrs)) {
      const key = a[1].toLowerCase();
      const value = a[3] ?? a[4] ?? a[5] ?? "";
      if (key.startsWith("on")) continue;
      if (key === "style") { const style = cleanStyle(decode(value)); if (style) attrs.push(`style="${escapeAttr(style)}"`); }
      else if (key === "href" && name === "a") { const url = safeUrl(value, false); if (url) attrs.push(`href="${escapeAttr(decode(url))}"`, 'target="_blank"', 'rel="noopener noreferrer"'); }
      else if (key === "src" && name === "img") { const url = safeUrl(value, true); if (url) attrs.push(`src="${escapeAttr(url)}"`); }
      else if (["color", "face", "size"].includes(key) && name === "font") attrs.push(`${key}="${escapeAttr(decode(value)).slice(0, 80)}"`);
      else if (["align", "colspan", "rowspan", "width", "height", "border", "cellpadding", "cellspacing", "valign", "alt", "dir", "nowrap", "role"].includes(key)) attrs.push(`${key}="${escapeAttr(decode(value)).slice(0, 200)}"`);
    }
    out += `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  }
  out += source.slice(last).replace(/</g, "&lt;");
  return out;
}

export const QUOTE_MARKER = "<!--rf-quote-->";
const BODY_OPEN = /<body\b[^>]*>/i;

/** Puts the user's part on top of the quoted conversation that Outlook generated for a reply/forward. */
export function combineDraftBody(ownHtml: string, quoteHtml: string) {
  const own = `<div id="rf-compose">${ownHtml}</div>${QUOTE_MARKER}`;
  if (!quoteHtml) return own;
  if (BODY_OPEN.test(quoteHtml)) return quoteHtml.replace(BODY_OPEN, opening => opening + own);
  return own + quoteHtml;
}

/** Splits a saved draft back into the editable part and the quoted original. */
export function splitDraftBody(content: string): { own: string; quote: string } {
  const html = content || "";
  const open = BODY_OPEN.exec(html);
  const start = open ? open.index + open[0].length : 0;
  const unwrap = (own: string) => own.replace(/^\s*<div id="(?:x_)?rf-compose">([\s\S]*)<\/div>\s*$/i, "$1");
  const cut = (end: number, resume: number) => ({ own: unwrap(html.slice(start, end)), quote: html.slice(0, start) + html.slice(resume) });
  const marker = html.indexOf(QUOTE_MARKER, start);
  if (marker >= 0) return cut(marker, marker + QUOTE_MARKER.length);
  // Drafts started in Outlook: the quote begins at Outlook's own reply separator.
  const separator = /<div id="(?:x_)?appendonsend"|<hr[^>]*>\s*<div id="(?:x_)?divRplyFwdMsg"|<div id="(?:x_)?divRplyFwdMsg"/i.exec(html.slice(start));
  if (separator) return cut(start + separator.index, start + separator.index);
  const end = /<\/body>/i.exec(html);
  return { own: unwrap(html.slice(start, end ? end.index : html.length)), quote: "" };
}

export const htmlToText = (html: string) => decode(html.replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).replace(/\n{3,}/g, "\n\n").trim();
