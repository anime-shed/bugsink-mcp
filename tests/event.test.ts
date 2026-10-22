import { describe, it, expect } from "vitest";
import {
  filterFrames,
  formatEventSummary,
  truncateText,
  extractEventExceptions,
  extractEventBreadcrumbs,
} from "../src/presentation.js";
import type { Event, StackFrame } from "../src/bugsink-client.js";

describe("Presentation and Event Processing Helpers", () => {
  const sampleFrames: StackFrame[] = [
    {
      filename: "vendor/laravel/framework/src/Illuminate/Routing/Router.php",
      function: "dispatch",
      lineno: 700,
      in_app: false,
      context_line: "return $this->runRoute($request, $route);",
    },
    {
      filename: "app/Http/Controllers/OrderController.php",
      function: "checkout",
      lineno: 42,
      in_app: true,
      context_line: "$order->process();",
    },
    {
      filename: "node_modules/express/lib/router/index.js",
      function: "handle",
      lineno: 120,
      context_line: "fn(req, res, next);",
    },
  ];

  it("filters vendor and node_modules frames when applicationOnly is true", () => {
    const appFrames = filterFrames(sampleFrames, true, true);
    expect(appFrames.length).toBe(1);
    expect(appFrames[0].filename).toBe("app/Http/Controllers/OrderController.php");
    expect(appFrames[0].context_line).toBe("$order->process();");

    const allFrames = filterFrames(sampleFrames, false, true);
    expect(allFrames.length).toBe(3);
  });

  it("omits source context lines when includeSource is false", () => {
    const framesNoSource = filterFrames(sampleFrames, true, false);
    expect(framesNoSource.length).toBe(1);
    expect(framesNoSource[0].filename).toBe("app/Http/Controllers/OrderController.php");
    expect(framesNoSource[0].context_line).toBeUndefined();
  });

  it("truncates long text within character bounds", () => {
    const short = truncateText("hello world", 50);
    expect(short).toBe("hello world");

    const long = truncateText("a".repeat(100), 20);
    expect(long.length).toBeLessThanOrEqual(35);
    expect(long).toContain("... [truncated]");
  });

  it("formats compact event summary", () => {
    const sampleEvent: Event = {
      id: "evt-123",
      event_id: "sdk-456",
      issue: "iss-789",
      project: 1,
      timestamp: "2026-06-24T12:00:00Z",
      ingested_at: "2026-06-24T12:00:01Z",
      digested_at: "2026-06-24T12:00:02Z",
      digest_order: 1,
      grouping: 1,
      data: {
        level: "error",
        platform: "php",
        message: "Division by zero",
        exception: {
          values: [
            {
              type: "DivisionByZeroError",
              value: "Modulo by zero",
            },
          ],
        },
        request: {
          url: "https://api.example.com/checkout",
          method: "POST",
        },
      },
    };

    const summary = formatEventSummary(sampleEvent);
    expect(summary).toContain("Event ID: evt-123");
    expect(summary).toContain("DivisionByZeroError: Modulo by zero");
    expect(summary).toContain("POST https://api.example.com/checkout");
  });

  it("extracts structured exceptions and breadcrumbs safely", () => {
    const eventWithData: Event = {
      id: "evt-123",
      event_id: "sdk-456",
      issue: "iss-789",
      project: 1,
      timestamp: "2026-06-24T12:00:00Z",
      ingested_at: "2026-06-24T12:00:01Z",
      digested_at: "2026-06-24T12:00:02Z",
      digest_order: 1,
      grouping: 1,
      data: {
        exception: {
          values: [
            {
              type: "RuntimeException",
              value: "Invalid state",
            },
          ],
        },
        contexts: {
          breadcrumbs: [
            { category: "ui.click", message: "Submit clicked", level: "info" },
          ],
        },
      },
    };

    const exceptions = extractEventExceptions(eventWithData);
    expect(exceptions).toEqual([{ type: "RuntimeException", value: "Invalid state" }]);

    const breadcrumbs = extractEventBreadcrumbs(eventWithData);
    expect(breadcrumbs.length).toBe(1);
    expect(breadcrumbs[0].category).toBe("ui.click");
  });
});
