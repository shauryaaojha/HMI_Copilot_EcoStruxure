/**
 * S4: the Email and Password boxes on the sign-in form have no accessible name.
 *
 * Field (src/components/ui/Field.tsx) renders <label htmlFor={id}> with a generated id
 * but never passes that id to its child, so the label points at nothing. Live on
 * production /signin the accessibility tree shows two unnamed "textbox" elements: a
 * screen reader announces "edit text" twice, and clicking the label does not focus.
 * Every Field in the app has the same defect (Settings, Share dialog, Connections).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInForm } from "@/components/shell/SignInForm";

describe("the sign-in form", () => {
  it("ties each label to its input", () => {
    const markup = renderToStaticMarkup(createElement(SignInForm));
    const fors = [...markup.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
    const ids = new Set([...markup.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
    expect(fors.length).toBeGreaterThanOrEqual(2);
    const dangling = fors.filter((f) => !ids.has(f));
    expect(dangling, `labels point at ids no input has: ${dangling.join(", ")}`).toEqual([]);
  });
});
