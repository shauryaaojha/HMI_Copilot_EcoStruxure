/**
 * The Phase 3 and 4 front end, tested where it can go wrong on its own:
 * SSE framing, and whether the local emitter honours the frozen contract in
 * src/types/events.ts.
 *
 * The second of those matters more than it looks. The emitter exists so the
 * timeline and the canvas can be built before /api/generate is live, which is
 * only useful if it emits exactly what the real route will - same events, same
 * order, same objects. A mock that drifts is worse than no mock, because the
 * UI is then built against something that will never arrive.
 */

import { describe, expect, it } from "vitest";
import { readEvents } from "@/components/generation/sse";
import { mockGeneration } from "@/components/generation/mockPipeline";
import { PIPELINE_STEPS, type GenerationEvent } from "@/types/events";
import { demoScreen, demoVariables } from "@/fixtures";

/** A body that hands out exactly these chunks, to control where frames split. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: AsyncGenerator<GenerationEvent>) {
  const out: GenerationEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

describe("SSE framing", () => {
  it("reads several frames out of one chunk", async () => {
    const events = await collect(
      readEvents(
        streamOf([
          'data: {"type":"log","at":"10:00:00","message":"one"}\n\n' +
            'data: {"type":"log","at":"10:00:01","message":"two"}\n\n',
        ]),
      ),
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e.type === "log" ? e.message : null))).toEqual([
      "one",
      "two",
    ]);
  });

  it("reassembles a frame split across chunks", async () => {
    const events = await collect(
      readEvents(streamOf(['data: {"type":"do', 'ne","screenId":"abc"}', "\n\n"])),
    );
    expect(events).toEqual([{ type: "done", screenId: "abc" }]);
  });

  it("survives a multi-byte character cut in half", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"type":"log","at":"t","message":"36.4 °C"}\n\n');
    const cut = bytes.indexOf(0xc2); // the first byte of "°"
    const events = await collect(
      readEvents(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, cut + 1));
            controller.enqueue(bytes.slice(cut + 1));
            controller.close();
          },
        }),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0].type === "log" && events[0].message).toBe("36.4 °C");
  });

  it("drops a malformed frame instead of killing the run", async () => {
    const events = await collect(
      readEvents(
        streamOf([
          "data: {not json}\n\n" + 'data: {"type":"done","screenId":"ok"}\n\n',
        ]),
      ),
    );
    expect(events).toEqual([{ type: "done", screenId: "ok" }]);
  });

  it("yields a final frame that arrived without its blank line", async () => {
    const events = await collect(
      readEvents(streamOf(['data: {"type":"done","screenId":"z"}'])),
    );
    expect(events).toEqual([{ type: "done", screenId: "z" }]);
  });
});

describe("the local pipeline honours the frozen event contract", () => {
  const run = () =>
    collect(mockGeneration({ intent: "two pumps", variables: demoVariables, pace: 0 }));

  it("runs all eight steps, each once, in the declared order", async () => {
    const events = await run();
    const started = events.filter(
      (e): e is Extract<GenerationEvent, { type: "step" }> =>
        e.type === "step" && e.state === "running",
    );
    expect(started.map((e) => e.step)).toEqual([...PIPELINE_STEPS]);

    for (const step of PIPELINE_STEPS) {
      const finished = events.filter(
        (e) => e.type === "step" && e.step === step && e.state === "done",
      );
      expect(finished, `${step} did not finish exactly once`).toHaveLength(1);
    }
  });

  it("ends with done, and emits no error", async () => {
    const events = await run();
    expect(events.at(-1)?.type).toBe("done");
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("describes each step by what it produced, not by what it is thinking", async () => {
    const events = await run();
    const details = events
      .filter((e) => e.type === "step" && e.state === "done")
      .map((e) => (e.type === "step" ? e.detail : undefined));

    expect(details.every((d) => typeof d === "string" && d.length > 0)).toBe(true);
    for (const detail of details) {
      expect(detail).not.toMatch(/think|analy[sz]ing|working|please wait/i);
    }
    // The counts are real, not decorative.
    expect(details).toContain(`${demoVariables.length} tags parsed`);
    expect(details).toContain(
      `${demoScreen.Children[0].Children.length} objects placed`,
    );
  });

  it("emits only objects the packager could emit", async () => {
    // The one rule in docs/BUILD_PLAN.md. Every object the emitter produces has
    // to be one of the fixture's, which came out of a file that opens in OTE -
    // a plausible-looking invented object would make the canvas a mockup again.
    const events = await run();
    const emitted = events.filter(
      (e): e is Extract<GenerationEvent, { type: "object" }> => e.type === "object",
    );
    const real = new Set(demoScreen.Children[0].Children.map((p) => p.UniqueId));

    expect(emitted.length).toBe(real.size);
    for (const event of emitted) {
      expect(real.has(event.part.UniqueId), `${event.part.Name} is not a real part`).toBe(true);
      expect(event.parentId).toBe(demoScreen.Children[0].UniqueId);
    }
  });

  it("infers equipment from the tag names rather than from the intent", async () => {
    const events = await run();
    const equipment = events.find(
      (e): e is Extract<GenerationEvent, { type: "equipment" }> => e.type === "equipment",
    );
    expect(equipment).toBeDefined();

    const labels = equipment!.equipment.map((e) => e.id);
    expect(labels).toContain("PMP_101");
    expect(labels).toContain("PMP_102");
    expect(equipment!.equipment.find((e) => e.id === "PMP_101")?.kind).toBe("pump");
    // Every inferred unit cites the tags it was inferred from.
    expect(equipment!.equipment.every((e) => e.tags.length > 0)).toBe(true);
  });

  it("binds each object to a tag and reports the ratio", async () => {
    const events = await run();
    const bindings = events.filter((e) => e.type === "binding");
    expect(bindings.length).toBeGreaterThan(0);

    const detail = events.find(
      (e) => e.type === "step" && e.step === "bindings" && e.state === "done",
    );
    expect(detail?.type === "step" && detail.detail).toMatch(
      new RegExp(`^${bindings.length}/\\d+ bound$`),
    );
  });
});
