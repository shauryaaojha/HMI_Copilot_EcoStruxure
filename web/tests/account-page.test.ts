import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountSettings } from "@/components/account/AccountSettings";
import { AccountFrame } from "@/components/account/AccountFrame";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));

describe("account page controls", () => {
  it("shows identity, password and session actions, connections and typed deletion", () => {
    const html = renderToStaticMarkup(createElement(AccountFrame, { title: "Account", tabs: "account", children: createElement(AccountSettings, { name: "Alice", email: "alice@example.com" }) }));
    for (const text of ["Alice", "alice@example.com", "Connections", "Change password", "Sign out everywhere", "Type DELETE to confirm", "Delete account"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/account/connections"');
  });
});
