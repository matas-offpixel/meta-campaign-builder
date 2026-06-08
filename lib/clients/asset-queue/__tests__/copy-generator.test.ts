import { generateCopy } from "../copy-generator";
import type { CopyInput, CopyFallbackTemplates, CtaDefaults } from "../copy-generator";

// Mock the Anthropic SDK
jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

import Anthropic from "@anthropic-ai/sdk";

const INPUT: CopyInput = {
  assetName: "Brighton TOFU Reel",
  mediaType: "Video",
  funnel: "TOFU",
  location: "Brighton",
  eventName: "World Cup Watch Party Brighton",
  eventCode: "WC26-BRIGHTON",
};

const FALLBACKS: CopyFallbackTemplates = {
  TOFU: "Watch the action live in Brighton!",
  MOFU: "Learn more about our events.",
  BOFU: "Get your tickets now!",
};

const CTA_DEFAULTS: CtaDefaults = {
  TOFU: "WATCH_MORE",
  MOFU: "LEARN_MORE",
  BOFU: "GET_TICKETS",
};

function getMockCreate() {
  const instance = (Anthropic as jest.MockedClass<typeof Anthropic>).mock.results[0].value;
  return instance.messages.create as jest.Mock;
}

describe("generateCopy", () => {
  beforeEach(() => {
    (Anthropic as jest.MockedClass<typeof Anthropic>).mockClear();
    new Anthropic({ apiKey: "test" });
  });

  it("parses a well-formed Anthropic response", async () => {
    const mockCreate = getMockCreate();
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: JSON.stringify({ primary_text: "Watch the match live in Brighton!", headline: "WC26 Brighton" }),
        },
      ],
    });

    const result = await generateCopy(INPUT, FALLBACKS, CTA_DEFAULTS);
    expect(result.fromFallback).toBe(false);
    expect(result.primaryText).toBe("Watch the match live in Brighton!");
    expect(result.headline).toBe("WC26 Brighton");
    expect(result.ctaValue).toBe("WATCH_MORE");
  });

  it("falls back to copy_templates on malformed JSON response", async () => {
    const mockCreate = getMockCreate();
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "not valid json at all" }],
    });

    const result = await generateCopy(INPUT, FALLBACKS, CTA_DEFAULTS);
    expect(result.fromFallback).toBe(true);
    expect(result.primaryText).toBe("Watch the action live in Brighton!");
    expect(result.ctaValue).toBe("WATCH_MORE");
  });

  it("falls back on Anthropic API error", async () => {
    const mockCreate = getMockCreate();
    mockCreate.mockRejectedValueOnce(new Error("API unavailable"));

    const result = await generateCopy(INPUT, FALLBACKS, CTA_DEFAULTS);
    expect(result.fromFallback).toBe(true);
    expect(result.ctaValue).toBe("WATCH_MORE");
  });

  it("enforces 100-char primaryText limit", async () => {
    const mockCreate = getMockCreate();
    const longText = "A".repeat(200);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ primary_text: longText, headline: "Short" }) }],
    });

    const result = await generateCopy(INPUT, FALLBACKS, CTA_DEFAULTS);
    expect(result.primaryText.length).toBeLessThanOrEqual(100);
  });

  it("enforces 30-char headline limit", async () => {
    const mockCreate = getMockCreate();
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: JSON.stringify({ primary_text: "Short text", headline: "B".repeat(50) }) }],
    });

    const result = await generateCopy(INPUT, FALLBACKS, CTA_DEFAULTS);
    expect(result.headline.length).toBeLessThanOrEqual(30);
  });

  it("parses response wrapped in markdown code fences", async () => {
    const mockCreate = getMockCreate();
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "```json\n" + JSON.stringify({ primary_text: "Great event!", headline: "Join us" }) + "\n```",
        },
      ],
    });

    const result = await generateCopy(INPUT, FALLBACKS, CTA_DEFAULTS);
    expect(result.fromFallback).toBe(false);
    expect(result.primaryText).toBe("Great event!");
  });

  it("falls back with generic copy when no template exists for funnel", async () => {
    const mockCreate = getMockCreate();
    mockCreate.mockRejectedValueOnce(new Error("fail"));

    const result = await generateCopy(
      { ...INPUT, funnel: "UNKNOWN" },
      {}, // no templates
      {},  // no cta defaults
    );
    expect(result.fromFallback).toBe(true);
    expect(result.primaryText.length).toBeGreaterThan(0);
    expect(result.ctaValue).toBe("LEARN_MORE"); // hardcoded default
  });
});
