import test from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "nodemailer";
import { customerEmailContent } from "../src/services/customer-email.js";
import { sendEmail } from "../src/services/email.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");

test("text-only email escapes HTML and preserves line breaks", () => {
  const content = customerEmailContent('<script>"&\'</script>\nOferta');
  assert.match(content.html, /&lt;script&gt;&quot;&amp;&#39;&lt;\/script&gt;<br>Oferta/);
  assert.equal(content.attachments, undefined);
});

test("flyer is embedded as CID MIME part using supplied transport", async () => {
  const transport = createTransport({ streamTransport: true, buffer: true });
  const content = customerEmailContent("Oferta", { mimetype: "image/png", buffer: png }, "https://restaurant.example");
  assert.match(content.html, /<a href="https:\/\/restaurant\.example\/"[^>]*><img[^>]*><\/a>/);
  const result = await sendEmail({ from: "admin@example.com", to: "customer@example.com", subject: "Promoción", ...content }, transport);
  const mime = result.message.toString();
  assert.match(mime, /Content-Type: multipart\/related/);
  assert.match(mime, /Content-ID: <promotion-flyer@delivery>/);
  assert.match(mime, /Content-Disposition: inline/);
  assert.match(mime, /cid:promotion-flyer@delivery/);
  assert.match(mime, /Content-Type: text\/plain/);
  transport.close();
});

test("invalid and oversized flyers rejected", () => {
  for (const image of [
    { mimetype: "image/svg+xml", buffer: Buffer.from("<svg/>") },
    { mimetype: "image/png", buffer: Buffer.from("fake") },
    { mimetype: "image/png", buffer: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]) },
  ]) assert.throws(() => customerEmailContent("Oferta", image), { status: 400 });
});

test("flyer rejects missing or unsafe website URL", () => {
  for (const url of ["", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path"]) {
    assert.throws(() => customerEmailContent("Oferta", { mimetype: "image/png", buffer: png }, url), { status: 503 });
  }
});
