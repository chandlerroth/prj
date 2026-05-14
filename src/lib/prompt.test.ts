import { test, expect, beforeEach, afterEach } from "bun:test";
import { confirm, promptText, select } from "./prompt.ts";

const origStderrWrite = process.stderr.write;
const origResume = process.stdin.resume;
const origPause = process.stdin.pause;
const origSetRawMode = process.stdin.setRawMode;
const origIsTTY = process.stdin.isTTY;

let stderr = "";

beforeEach(() => {
  stderr = "";
  // @ts-expect-error test stub
  process.stderr.write = (chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  };
  // @ts-expect-error test stub
  process.stdin.resume = () => process.stdin;
  // @ts-expect-error test stub
  process.stdin.pause = () => process.stdin;
  // @ts-expect-error test stub
  process.stdin.setRawMode = () => process.stdin;
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
});

afterEach(() => {
  process.stderr.write = origStderrWrite;
  process.stdin.resume = origResume;
  process.stdin.pause = origPause;
  process.stdin.setRawMode = origSetRawMode;
  Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
});

test("promptText returns typed input on enter", async () => {
  const p = promptText("Name: ");
  process.stdin.emit("data", Buffer.from("alice\r"));
  await expect(p).resolves.toBe("alice");
  expect(stderr).toContain("Name: ");
});

test("promptText returns null on ctrl-c", async () => {
  const p = promptText("Token: ");
  process.stdin.emit("data", Buffer.from("\x03"));
  await expect(p).resolves.toBeNull();
});

test("confirm accepts yes", async () => {
  const p = confirm("Continue? ");
  process.stdin.emit("data", Buffer.from("yes\r"));
  await expect(p).resolves.toBe(true);
});

test("confirm rejects other answers", async () => {
  const p = confirm("Continue? ");
  process.stdin.emit("data", Buffer.from("no\r"));
  await expect(p).resolves.toBe(false);
});

test("select returns null for empty options", async () => {
  await expect(select([])).resolves.toBeNull();
});

test("select filters options and returns the active match on enter", async () => {
  const p = select([
    { label: "alpha", value: "a" },
    { label: "bravo", value: "b" },
  ]);
  process.stdin.emit("data", Buffer.from("b"));
  process.stdin.emit("data", Buffer.from("\r"));
  await expect(p).resolves.toBe("b");
  expect(stderr).toContain("filter:");
});

test("select returns null on escape", async () => {
  const p = select([{ label: "alpha", value: "a" }]);
  process.stdin.emit("data", Buffer.from("\x1b"));
  await expect(p).resolves.toBeNull();
});

test("select onReady receives a control that lives until pick, then aborts", async () => {
  let captured: { closed: boolean; signal: AbortSignal } | null = null;
  const p = select(
    [
      { label: "alpha", value: "a" },
      { label: "bravo", value: "b" },
    ],
    {
      onReady(control) {
        captured = control;
        // Update bravo's hint while the prompt is open.
        control.setHint("b", "(updated)");
      },
    },
  );

  expect(captured).not.toBeNull();
  expect(captured!.closed).toBe(false);
  expect(captured!.signal.aborted).toBe(false);
  // Hint update should be visible in the rendered output.
  expect(stderr).toContain("(updated)");

  process.stdin.emit("data", Buffer.from("\r"));
  await expect(p).resolves.toBe("a");

  expect(captured!.closed).toBe(true);
  expect(captured!.signal.aborted).toBe(true);
});
