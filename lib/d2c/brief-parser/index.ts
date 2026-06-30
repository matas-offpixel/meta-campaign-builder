/**
 * lib/d2c/brief-parser/index.ts
 *
 * parseBrief(pdfBuffer) — turns an event brief PDF into the structured
 * contract the orchestration pipeline consumes:
 *   { event, copy, scheduled_sends }
 *
 * The PDF is passed to Anthropic as a native document block (no PDF parsing
 * dependency). A tool/JSON schema forces structured output. Schedule rows are
 * derived deterministically in `./schedule.ts` from the parsed milestones —
 * the model only proposes the event row + per-milestone copy.
 *
 * The Anthropic client is injectable so the parser is unit-testable without
 * hitting the wire (see __tests__/brief-parser.test.ts).
 */

import {
  BriefValidationError,
  D2C_JOB_TYPES,
  type BriefEventInsert,
  type BriefParseResult,
  type BriefScheduledSendInsert,
  type D2CChannel,
  type D2CEventCopyBundle,
  type D2CJobType,
  type D2CRenderedCopyBlock,
} from "../types.ts";
import { computeSchedule, SCHEDULE_JOB_ORDER } from "./schedule.ts";

export const BRIEF_PARSER_MODEL =
  process.env.D2C_BRIEF_PARSER_MODEL?.trim() || "claude-opus-4-6";

const TOOL_NAME = "record_event_brief";

/** Which channel each milestone goes out on. */
export const CHANNEL_BY_JOB_TYPE: Record<D2CJobType, D2CChannel> = {
  announce: "email",
  reminder: "email",
  community_early: "whatsapp",
  presale_live: "email",
  gen_sale: "email",
  autoresp_setup: "whatsapp",
};

const REQUIRED_EVENT_FIELDS: (keyof BriefEventInsert)[] = [
  "name",
  "venue_name",
  "venue_city",
  "event_timezone",
  "presale_at",
  "general_sale_at",
  "ticket_url",
];

/** Friendly aliases used in validation error messages (matches the brief spec). */
const FIELD_LABELS: Partial<Record<keyof BriefEventInsert, string>> = {
  name: "event_name",
  venue_name: "venue",
  venue_city: "city",
  event_timezone: "timezone",
};

// ── Minimal Anthropic surface (so tests can inject a fake) ─────────────────

export interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}
export interface AnthropicTextBlock {
  type: "text";
  text: string;
}
export type AnthropicContentBlock =
  | AnthropicToolUseBlock
  | AnthropicTextBlock
  | { type: string; [k: string]: unknown };

export interface AnthropicLike {
  messages: {
    create(args: Record<string, unknown>): Promise<{
      content: AnthropicContentBlock[];
    }>;
  };
}

export interface ParseBriefDeps {
  anthropic?: AnthropicLike;
  model?: string;
  /** Already-extracted text instead of a PDF (manual path). */
  briefText?: string;
}

const SYSTEM_PROMPT = `You are an expert event-marketing operator. You read a single event brief (PDF or text) for a live music / club / sports event and extract a precise, structured campaign specification.

Return your answer ONLY by calling the ${TOOL_NAME} tool. Do not write prose.

Rules:
- All timestamps MUST be full ISO-8601 with timezone offset or Z (e.g. 2026-09-01T10:00:00Z). If the brief gives a local time, convert using the venue's IANA timezone.
- event_timezone MUST be a valid IANA timezone string (e.g. Europe/London).
- Write the per-milestone copy in the brand's voice. Keep WhatsApp copy short and punchy; email copy can be richer markdown.
- For community_early copy, include the literal token {{community_url}} where the WhatsApp community link should appear — an operator pastes it before sending.
- Always substitute these tokens where natural: {{event_name}}, {{ticket_url}}, {{venue_name}}, {{city}}, {{presale_start_at_local}}, {{general_sale_at_local}}.
- Provide copy for all six milestones: announce, reminder, community_early, presale_live, gen_sale, autoresp_setup.`;

function buildTool() {
  const copyBlock = {
    type: "object",
    properties: {
      subject: { type: ["string", "null"], description: "Email subject; null for WhatsApp." },
      body_markdown: { type: "string" },
    },
    required: ["body_markdown"],
    additionalProperties: false,
  };
  return {
    name: TOOL_NAME,
    description:
      "Record the structured event brief: the event row and per-milestone copy.",
    input_schema: {
      type: "object",
      properties: {
        event: {
          type: "object",
          properties: {
            name: { type: "string" },
            venue_name: { type: "string" },
            venue_city: { type: "string" },
            venue_country: { type: ["string", "null"] },
            event_timezone: { type: "string", description: "IANA tz, e.g. Europe/London" },
            event_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            event_start_at: { type: ["string", "null"], description: "ISO-8601" },
            announcement_at: { type: ["string", "null"], description: "ISO-8601" },
            signup_launch_at: { type: ["string", "null"], description: "ISO-8601" },
            presale_at: { type: "string", description: "ISO-8601" },
            general_sale_at: { type: "string", description: "ISO-8601" },
            ticket_url: { type: "string" },
            signup_url: { type: ["string", "null"] },
            event_code: { type: ["string", "null"] },
            capacity: { type: ["number", "null"] },
          },
          required: [
            "name",
            "venue_name",
            "venue_city",
            "event_timezone",
            "presale_at",
            "general_sale_at",
            "ticket_url",
          ],
          additionalProperties: false,
        },
        copy: {
          type: "object",
          properties: {
            announce: copyBlock,
            reminder: copyBlock,
            community_early: copyBlock,
            presale_live: copyBlock,
            gen_sale: copyBlock,
            autoresp_setup: copyBlock,
          },
          required: [...D2C_JOB_TYPES],
          additionalProperties: false,
        },
      },
      required: ["event", "copy"],
      additionalProperties: false,
    },
  };
}

interface ModelOutput {
  event: BriefEventInsert;
  copy: Record<string, D2CRenderedCopyBlock>;
}

function buildUserContent(
  pdfBuffer: Buffer | null,
  briefText: string | undefined,
): unknown[] {
  const content: unknown[] = [];
  if (pdfBuffer && pdfBuffer.length > 0) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdfBuffer.toString("base64"),
      },
    });
  }
  if (briefText && briefText.trim()) {
    content.push({ type: "text", text: briefText });
  }
  content.push({
    type: "text",
    text: `Extract the event brief and call ${TOOL_NAME}.`,
  });
  return content;
}

function extractToolInput(content: AnthropicContentBlock[]): ModelOutput {
  for (const block of content) {
    if (block.type === "tool_use" && (block as AnthropicToolUseBlock).name === TOOL_NAME) {
      const input = (block as AnthropicToolUseBlock).input;
      if (input && typeof input === "object") {
        return input as ModelOutput;
      }
    }
  }
  throw new BriefValidationError(
    [],
    "Model did not return a structured brief (no tool_use block).",
  );
}

function validateEvent(event: BriefEventInsert): void {
  const missing: string[] = [];
  for (const field of REQUIRED_EVENT_FIELDS) {
    const v = event[field];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      missing.push(FIELD_LABELS[field] ?? field);
    }
  }
  // Validate timezone is recognised.
  if (event.event_timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: event.event_timezone });
    } catch {
      missing.push("timezone (invalid IANA zone)");
    }
  }
  for (const tsField of ["presale_at", "general_sale_at"] as const) {
    const v = event[tsField];
    if (v && Number.isNaN(new Date(v).getTime())) {
      missing.push(`${tsField} (invalid date)`);
    }
  }
  if (missing.length > 0) {
    throw new BriefValidationError(missing);
  }
}

function buildScheduledSends(
  event: BriefEventInsert,
  copy: Record<string, D2CRenderedCopyBlock>,
): { sends: BriefScheduledSendInsert[]; bundle: D2CEventCopyBundle } {
  const schedule = computeSchedule(event);
  const sends: BriefScheduledSendInsert[] = [];
  const bundle: D2CEventCopyBundle = {};

  for (const jobType of SCHEDULE_JOB_ORDER) {
    const block = copy[jobType];
    if (!block || typeof block.body_markdown !== "string") continue;
    bundle[jobType] = {
      subject: block.subject ?? null,
      body_markdown: block.body_markdown,
    };
    sends.push({
      job_type: jobType,
      channel: CHANNEL_BY_JOB_TYPE[jobType],
      scheduled_for: schedule[jobType],
      subject: block.subject ?? null,
      body_markdown: block.body_markdown,
    });
  }
  return { sends, bundle };
}

/**
 * Parse a brief PDF (or text) into the structured campaign contract.
 *
 * @throws {BriefValidationError} when required fields are missing/invalid.
 */
export async function parseBrief(
  pdfBuffer: Buffer | null,
  deps: ParseBriefDeps = {},
): Promise<BriefParseResult> {
  const anthropic = deps.anthropic ?? (await defaultAnthropic());
  const model = deps.model ?? BRIEF_PARSER_MODEL;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [buildTool()],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: buildUserContent(pdfBuffer, deps.briefText),
      },
    ],
  });

  const output = extractToolInput(response.content);
  const event = output.event;
  validateEvent(event);

  const { sends, bundle } = buildScheduledSends(event, output.copy ?? {});

  return {
    event,
    copy: { copy_jsonb: bundle },
    scheduled_sends: sends,
  };
}

async function defaultAnthropic(): Promise<AnthropicLike> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — required to parse briefs.",
    );
  }
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  return new Anthropic({ apiKey }) as unknown as AnthropicLike;
}
