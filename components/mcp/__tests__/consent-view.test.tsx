/** The MCP consent page body (#1371): Claude vs loopback wording, the untrusted registered name escaped, quoted and capped. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConsentView } from "@/components/mcp/consent-view";
import { CLAUDE_CALLBACK } from "@/lib/mcp/config";
import { CLIENT_NAME_MAX, consentContent } from "@/lib/mcp/oauth/consent-words";

afterEach(() => {
  cleanup();
});

const EMAIL = "matas.offpixel.operator@offpixel.co.uk";

describe("MCP consent view", () => {
  it("renders the Claude wording with both buttons", () => {
    const content = consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: EMAIL, returnHost: "claude.ai" });
    render(<ConsentView view={{ state: "consent", content }} />);
    expect(screen.getByRole("heading").textContent).toBe("Connect Claude to Off/Pixel");
    expect(screen.getByText(`Claude is asking to read Off/Pixel as ${EMAIL}.`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    // Design round 2: Allow keeps the primary fill and gains a 1 px border in the page's ink.
    const allow = screen.getByRole("button", { name: "Allow" });
    expect(allow.className).toContain("bg-primary");
    expect(allow.className).toContain("border border-foreground");
    expect(screen.getByRole("button", { name: "Cancel" }).className).not.toContain("border-foreground");
  });

  it("renders no dark: classes, the Button's included (a light page in Claude's dark sheet is fine; ruling 1)", () => {
    const content = consentContent({ redirectUri: CLAUDE_CALLBACK, clientName: "Claude", email: EMAIL, returnHost: "claude.ai" });
    const { container } = render(<ConsentView view={{ state: "consent", content }} />);
    expect(container.innerHTML).not.toMatch(/\bdark:/);
  });

  it("renders a registered name with markup and quotes as text, quoted and capped", () => {
    const evil = `<img src=x onerror="alert(1)"> "Claude" & <b>friends</b> ${"x".repeat(80)}`;
    const content = consentContent({ redirectUri: "http://localhost:53682/callback", clientName: evil, email: EMAIL, returnHost: "localhost:53682" });
    const { container } = render(<ConsentView view={{ state: "consent", content }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    const line = content.lines[0];
    expect(screen.getByText(line)).toBeTruthy();
    const name = /calling itself “(.*)”, is asking/.exec(line)![1]!;
    expect([...name].length).toBeLessThanOrEqual(CLIENT_NAME_MAX);
    expect(name.endsWith("…")).toBe(true);
    expect(screen.getByRole("heading").textContent).toBe("Connect an app on this computer to Off/Pixel");
  });

  it("states: invalid, signed out (with Sign in), not an operator", () => {
    const { rerender } = render(<ConsentView view={{ state: "invalid" }} />);
    expect(screen.getByText("This connection link isn't valid. Start again from Claude.")).toBeTruthy();
    rerender(<ConsentView view={{ state: "signed_out" }} />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
    rerender(<ConsentView view={{ state: "not_operator" }} />);
    expect(screen.getByText("This account can't connect Claude to Off/Pixel.")).toBeTruthy();
  });
});
