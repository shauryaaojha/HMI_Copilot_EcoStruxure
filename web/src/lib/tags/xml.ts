/**
 * Just enough XML to read PLC exchange files, in the browser and in Node.
 *
 * Control Expert writes plain, well-formed XML with attributes that may wrap
 * across lines (`topologicalAddress` on its own line is common) and text in
 * `<comment>` elements. That is all this handles: elements, attributes, text,
 * CDATA, comments and the five predefined entities plus numeric references. No
 * DTDs, no namespaces beyond keeping the prefix in the name, and no external
 * anything - an exchange file never needs them, and a parser that resolves
 * external entities is a vulnerability rather than a feature.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[body.toLowerCase()] ?? whole;
  });
}

const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Parse a document into a tree. Throws with a line number on markup that is
 * not well formed, because a half-read exchange file silently missing its last
 * hundred variables is worse than a refusal.
 */
export function parseXml(input: string): XmlNode {
  const text = input.replace(/^﻿/, "");
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;
  const lineAt = (pos: number) => text.slice(0, pos).split("\n").length;

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(text.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(text.slice(i, lt));

    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) throw new Error(`unterminated comment at line ${lineAt(lt)}`);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error(`unterminated CDATA at line ${lineAt(lt)}`);
      stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt) || text.startsWith("<!", lt)) {
      const end = text.indexOf(">", lt);
      if (end < 0) throw new Error(`unterminated declaration at line ${lineAt(lt)}`);
      i = end + 1;
      continue;
    }

    // A tag. Find its end while respecting quoted attribute values, which may
    // legitimately contain '>'.
    let j = lt + 1;
    let quote: string | null = null;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= text.length) throw new Error(`unterminated tag at line ${lineAt(lt)}`);
    const raw = text.slice(lt + 1, j);
    i = j + 1;

    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (!open || open === root || open.name !== name) {
        throw new Error(`</${name}> at line ${lineAt(lt)} does not close <${open?.name ?? "nothing"}>`);
      }
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const name = body.match(/^\s*([A-Za-z_][\w:.-]*)/)?.[1];
    if (!name) throw new Error(`malformed tag at line ${lineAt(lt)}`);
    const attrs: Record<string, string> = {};
    for (const m of body.slice(name.length).matchAll(ATTR)) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
    const node: XmlNode = { name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length > 1) throw new Error(`<${stack[stack.length - 1].name}> is never closed`);
  return root;
}

/** Direct children with this element name. */
export const childrenNamed = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name);

/** The first direct child with this name. */
export const childNamed = (node: XmlNode, name: string) => node.children.find((c) => c.name === name);

/** Every descendant, depth first, with this name. */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
